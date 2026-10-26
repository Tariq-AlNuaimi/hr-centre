import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import type { CreateMoveInput } from "@/lib/validations/jml/move";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { resolveHrAssignment } from "../engine/assignment";
import { nextCaseRef, withCaseRefRetry } from "../engine/case-ref";
import { generateTasks } from "../engine/generate";
import { materialiseTasks } from "../engine/materialise";
import { selectJoinOrMoveTemplate, templateTaskDefs } from "../engine/templates";
import { joinFacts } from "../join/facts";
import { placementSubject } from "../join/joiner-data";
import { detailsOf, loadMoveEmployee, snapshots, type MoveEmployee } from "./profile";
import {
  applyChangeRules,
  changedFields,
  changeRefusal,
  overlayDetails,
  type EmployeeDetails,
} from "./rules";

/**
 * Start an internal change — HR Onboarding `createInternalChange`
 * (`internal-change.ts:151-325`, R1–R10). Owner, template and task conditions
 * all read the NEW position; the snapshots record the changed fields with their
 * labels as they were named today. Unlike the source (R6), nothing is written to
 * the employee now: the change is applied when the case completes (D9).
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

async function assertNewReferences(next: EmployeeDetails, current: EmployeeDetails) {
  if (next.managerId && next.managerId !== current.managerId) {
    const m = await prisma.employee.findUnique({
      where: { id: next.managerId },
      select: { status: true },
    });
    if (m?.status !== "ACTIVE")
      throw new JmlError("The new line manager must be an active employee.", 422);
  }
  if (next.contractTypeId && next.contractTypeId !== current.contractTypeId) {
    const c = await prisma.jmlContractType.findUnique({
      where: { id: next.contractTypeId },
      select: { active: true },
    });
    if (!c?.active) throw new JmlError("That contract type is not on the active list.", 422);
  }
}

async function factsFor(e: MoveEmployee, next: EmployeeDetails) {
  const [entity, contract] = await Promise.all([
    prisma.orgEntity.findUnique({ where: { id: next.entityId! }, select: { code: true } }),
    next.contractTypeId
      ? prisma.jmlContractType.findUnique({
          where: { id: next.contractTypeId },
          select: { code: true },
        })
      : null,
  ]);
  return joinFacts({
    companyCode: entity?.code ?? "",
    employmentType: next.employmentType ?? "",
    contractTypeCode: contract?.code ?? "",
    nationality: e.nationality ?? "",
    workLocation: next.workLocation ?? "",
    payrollApplicable: e.jmlCases[0]?.joinDetail?.payrollApplicable ?? true,
  });
}

async function buildCase(
  tx: Tx,
  actor: JmlActor,
  e: MoveEmployee,
  input: CreateMoveInput,
  placement: { entityId: string; directorateId: string | null; departmentId: string | null },
  facts: Awaited<ReturnType<typeof factsFor>>,
  snap: Awaited<ReturnType<typeof snapshots>>,
) {
  const owner = await resolveHrAssignment(placement, "MOVE", tx);
  if (!owner) {
    throw new JmlError(
      "No HR assignment rule covers the new position, so the change has no owner.",
      409,
    );
  }
  const template = await selectJoinOrMoveTemplate("MOVE", facts, input.changeType, tx);
  if (!template) {
    throw new JmlError(
      `No checklist template exists for ${input.changeType.replaceAll("_", " ").toLowerCase()}. Add one in JML settings first.`,
      409,
    );
  }
  const defs = await templateTaskDefs(template.id, tx);
  const tasks = generateTasks(
    defs,
    { caseType: "MOVE", facts, anchors: { EFFECTIVE_DATE: input.effectiveDate } },
    await loadWorkingCalendar(),
  );
  if (tasks.length === 0) {
    throw new JmlError(
      "Every task in the matching template is excluded by its conditions for this change.",
      409,
    );
  }
  const kase = await tx.jmlCase.create({
    data: {
      caseRef: await nextCaseRef(tx, "MOVE"),
      caseType: "MOVE",
      status: "ACTIVE",
      stage: "PREBOARDING",
      employeeId: e.id,
      hrOwnerUserId: owner.rule.juniorHr.id,
      seniorHrUserId: owner.rule.seniorHr.id,
      templateId: template.id,
      activatedAt: new Date(),
      lastUpdatedById: actor.userId,
    },
    select: { id: true, caseRef: true },
  });
  await tx.jmlMoveDetail.create({
    data: {
      caseId: kase.id,
      changeType: input.changeType,
      effectiveDate: input.effectiveDate,
      previousDetails: snap.previous as Prisma.InputJsonValue,
      newDetails: snap.next as Prisma.InputJsonValue,
    },
    select: { caseId: true },
  });
  const taskCount = await materialiseTasks(tx, kase.id, tasks, owner.rule.juniorHr.id);
  return { caseId: kase.id, caseRef: kase.caseRef, templateId: template.id, taskCount };
}

export async function createMove(actor: JmlActor, input: CreateMoveInput) {
  const { employee: e, subject } = await loadMoveEmployee(actor, input.employeeId);
  if (!canFor(actor, "jml.manageMovers", subject)) {
    throw new JmlError("You cannot start internal changes for this employee.", 403);
  }
  const refusal = changeRefusal(e);
  if (refusal) throw new JmlError(refusal, 409);
  const current = detailsOf(e);
  const next = applyChangeRules(
    input.changeType,
    current,
    overlayDetails(current, input.newDetails),
  );
  if (!next.entityId) throw new JmlError("The new position needs a company.", 422);
  const target = await placementSubject({
    entityId: next.entityId,
    departmentId: next.departmentId,
    teamId: next.teamId,
    roleTrack: e.roleTrack,
  });
  if (!canFor(actor, "jml.manageMovers", target)) {
    throw new JmlError("You cannot move an employee into that part of the group.", 403);
  }
  await assertNewReferences(next, current);
  const changed = changedFields(current, next);
  if (changed.length === 0) throw new JmlError("Nothing would change.", 422);
  const open = await prisma.jmlCase.findFirst({
    where: { employeeId: e.id, caseType: "MOVE", status: "ACTIVE" },
    select: { caseRef: true },
  });
  if (open)
    throw new JmlError(
      `${e.name} already has an internal change in progress (${open.caseRef}).`,
      409,
    );
  const [facts, snap] = await Promise.all([factsFor(e, next), snapshots(current, next, changed)]);
  const placement = {
    entityId: next.entityId,
    directorateId: target.directorateId ?? null,
    departmentId: target.departmentId ?? null,
  };
  return withCaseRefRetry(() =>
    auditedTransaction((tx) => buildCase(tx, actor, e, input, placement, facts, snap), {
      timeout: 20_000,
    }),
  );
}
