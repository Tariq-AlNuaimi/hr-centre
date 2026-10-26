import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { CreateExitInput, UpdateExitInput } from "@/lib/validations/jml/leave";
import { canFor, loadCaseFor, subjectOf, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { nextCaseRef, withCaseRefRetry } from "../engine/case-ref";
import { dateProblems, nationalityBranch } from "./rules";

/**
 * Exit drafts — HR Offboarding `POST /api/exits` on the core record. The
 * employee is PICKED: name, job, grade, placement, employment type, nationality
 * branch and line manager come from their record and are snapshotted (§8.3 of
 * the port spec). A draft generates no tasks, documents or notifications
 * (AC-1.1). The reference `EXIT-YYYY-NNNN` is issued at creation (as in the
 * source) and retried on a race.
 */

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  status: true,
  jobTitle: true,
  grade: true,
  nationality: true,
  contractType: true,
  managerId: true,
  entityId: true,
  departmentId: true,
  teamId: true,
  department: { select: { directorateId: true } },
  positionClassification: { select: { label: true } },
} as const satisfies Prisma.EmployeeSelect;

function snapshotOf(e: Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>) {
  return {
    employeeNameAtExit: e.name,
    jobTitleAtExit: e.jobTitle,
    gradeAtExit: e.grade,
    positionClassificationName: e.positionClassification?.label ?? null,
    entityIdAtExit: e.entityId,
    directorateIdAtExit: e.department?.directorateId ?? null,
    departmentIdAtExit: e.departmentId,
    teamIdAtExit: e.teamId,
    employmentTypeAtExit: e.contractType,
    lineManagerEmployeeId: e.managerId,
  };
}

export async function createExitDraft(actor: JmlActor, input: CreateExitInput) {
  const e = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: EMPLOYEE_SELECT,
  });
  if (!e) throw new JmlError("Employee not found", 404);
  const subject = subjectOf(e);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Employee not found", 404);
  if (!canFor(actor, "jml.manageLeavers", subject)) {
    throw new JmlError("You cannot open exit cases for this employee.", 403);
  }
  if (e.status === "PRE_JOINER") {
    throw new JmlError(`${e.name} has not joined yet — cancel their onboarding instead.`, 409);
  }
  const open = await prisma.jmlCase.findFirst({
    where: {
      employeeId: e.id,
      caseType: "LEAVE",
      status: { notIn: ["CLOSED", "CANCELLED", "ARCHIVED"] },
    },
    select: { caseRef: true },
  });
  if (open) throw new JmlError(`${e.name} already has an open exit case (${open.caseRef}).`, 409);
  const nationality = input.nationality ?? nationalityBranch(e.nationality);
  if (!nationality) {
    throw new JmlError(
      "No nationality is on file for this employee — choose the Omani or expatriate branch.",
      422,
    );
  }
  const problems = dateProblems({ ...input, nationality });
  if (problems.length > 0) throw new JmlError(problems.map((p) => p.message).join(" "), 422);
  const joined = await prisma.jmlCase.count({
    where: { employeeId: e.id, caseType: "JOIN", status: { not: "CANCELLED" } },
  });
  return withCaseRefRetry(() =>
    auditedTransaction(async (tx) => {
      const kase = await tx.jmlCase.create({
        data: {
          caseRef: await nextCaseRef(tx, "LEAVE"),
          caseType: "LEAVE",
          status: "DRAFT",
          stage: "STAGE_1_RESIGNATION",
          employeeId: e.id,
          lastUpdatedById: actor.userId,
        },
        select: { id: true, caseRef: true },
      });
      await tx.leaveCaseDetail.create({
        data: {
          caseId: kase.id,
          exitType: input.exitType,
          exitSubtype: input.exitSubtype,
          nationality,
          noticeStartDate: input.noticeStartDate,
          noticePeriodDays: input.noticePeriodDays,
          noticePeriodOverrideReason: input.noticePeriodOverrideReason,
          lastPhysicalWorkingDay: input.lastPhysicalWorkingDay,
          lastDayOfService: input.lastDayOfService,
          departureDate: input.departureDate,
          settlementApplicable: input.settlementApplicable,
          visaSupportApplicable: input.visaSupportApplicable,
          docRefPerformanceHistory: input.docRefPerformanceHistory,
          docRefWrittenGrounds: input.docRefWrittenGrounds,
          docRefLegalReview: input.docRefLegalReview,
          manuallyCreated: joined === 0,
          ...snapshotOf(e),
        },
        select: { caseId: true },
      });
      return kase;
    }),
  );
}

/** Refresh the snapshots at activation (the record may have changed since the draft). */
export async function refreshSnapshots(
  tx: Parameters<Parameters<typeof auditedTransaction>[0]>[0],
  caseId: string,
  employeeId: string,
) {
  const e = await tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: EMPLOYEE_SELECT,
  });
  await tx.leaveCaseDetail.update({
    where: { caseId },
    data: snapshotOf(e),
    select: { caseId: true },
  });
}

const TERMINAL = new Set(["CLOSED", "CANCELLED", "ARCHIVED"]);

/** Classification, flags, references, backfill and rehire (Offboarding PUT /api/exits/[id] + F4 writers). */
export async function updateExit(actor: JmlActor, caseId: string, input: UpdateExitInput) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (TERMINAL.has(kase.status)) throw new JmlError("This exit case is closed.", 409);
  if (kase.version !== input.expectedVersion) {
    throw new JmlError("Someone else changed this case. Reload and try again.", 409);
  }
  const { expectedVersion: _v, positionClassificationId, ...fields } = input;
  const data: Prisma.LeaveCaseDetailUpdateInput = { ...fields };
  if (positionClassificationId !== undefined) {
    const pc = positionClassificationId
      ? await prisma.positionClassification.findUnique({
          where: { id: positionClassificationId },
          select: { label: true, active: true },
        })
      : null;
    if (positionClassificationId && !pc?.active)
      throw new JmlError("That classification is not active.", 422);
    data.positionClassificationName = pc?.label ?? null;
  }
  await auditedTransaction(async (tx) => {
    await tx.leaveCaseDetail.update({ where: { caseId }, data, select: { caseId: true } });
    await tx.jmlCase.update({
      where: { id: caseId, version: kase.version },
      data: { version: { increment: 1 }, lastUpdatedById: actor.userId },
      select: { id: true },
    });
  });
  return { updated: true };
}
