import { randomBytes } from "node:crypto";
import type { ContractType, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { placeholderEmail, provisionalOdooId } from "@/lib/people/provisional-id";
import { employeeCreateData } from "@/lib/people/write";
import type { ScopeSubject } from "@/lib/rbac/grants";
import type { DraftJoinerInput } from "@/lib/validations/jml/joiner";
import { canFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import {
  joinerSubject,
  loadJoinerRow,
  placementSubject,
  serializeJoiner,
  type JoinerRow,
} from "./joiner-data";

/**
 * Joiner drafts — HR Onboarding `new-hire.ts` on the core record (D8).
 *
 * Saving a draft creates the PRE_JOINER `Employee` through the one writer
 * (`lib/people/write.ts`) with a provisional Odoo id and, until the work
 * address is issued, a placeholder email — and a DRAFT JOIN case holding the
 * joiner-only details. A draft has no EMP code, case number, task, email or IT
 * submission (AC-NEW-001); its reference is a `DRAFT-…` placeholder until
 * activation issues `ONB-YYYY-NNNN`.
 */

export const DRAFT_REF_PREFIX = "DRAFT-";

export function requireManage(actor: JmlActor, subject: ScopeSubject, missing: 403 | 404 = 403) {
  if (!canFor(actor, "jml.manageJoiners", subject)) {
    throw new JmlError(
      missing === 404 ? "Joiner not found" : "You cannot manage joiners in that part of the group.",
      missing,
    );
  }
}

export function requireSalaryIfGiven(actor: JmlActor, subject: ScopeSubject, salary: unknown) {
  if (salary !== undefined && salary !== null && !canFor(actor, "people.viewSalary", subject)) {
    throw new JmlError("You cannot record salary for this joiner.", 403);
  }
}

export async function assertReferences(input: {
  managerId?: string | null;
  contractTypeId?: string | null;
  workEmail?: string | null;
  employeeId?: string;
}) {
  if (input.managerId) {
    const manager = await prisma.employee.findUnique({
      where: { id: input.managerId },
      select: { status: true },
    });
    if (!manager || manager.status !== "ACTIVE") {
      throw new JmlError("The line manager must be an active employee.", 422);
    }
  }
  if (input.contractTypeId) {
    const type = await prisma.jmlContractType.findUnique({
      where: { id: input.contractTypeId },
      select: { active: true },
    });
    if (!type?.active) throw new JmlError("That contract type is not on the active list.", 422);
  }
  if (input.workEmail) {
    const taken = await prisma.employee.findUnique({
      where: { email: input.workEmail },
      select: { id: true },
    });
    if (taken && taken.id !== input.employeeId) {
      throw new JmlError(`${input.workEmail} already belongs to another employee.`, 409);
    }
  }
}

async function payrollDefault(type: ContractType | null): Promise<boolean> {
  if (!type) return true;
  const config = await prisma.jmlEmploymentTypeConfig.findUnique({
    where: { employmentType: type },
    select: { payrollApplicableDefault: true },
  });
  return config?.payrollApplicableDefault ?? true;
}

export async function createJoinerDraft(actor: JmlActor, input: DraftJoinerInput) {
  const subject = await placementSubject(input);
  requireManage(actor, subject);
  requireSalaryIfGiven(actor, subject, input.salary);
  await assertReferences(input);
  const payrollApplicable = input.payrollApplicable ?? (await payrollDefault(input.employmentType));
  const odooId = provisionalOdooId();
  const caseId = await auditedTransaction(async (tx) => {
    const employee = await tx.employee.create({
      data: employeeCreateData(
        {
          odooId,
          name: input.fullName,
          email: input.workEmail ?? placeholderEmail(),
          departmentId: input.departmentId,
          teamId: input.teamId,
          entityId: input.entityId,
          roleTrack: input.roleTrack,
          basicSalary: input.salary,
          status: "PRE_JOINER",
          // D8: a pre-joiner's joining date is the planned start until day one.
          dateOfJoining: input.plannedStartDate,
          lastWorkingDay: null,
          unpaidLeaveDays: 0,
        },
        {
          jobTitle: input.jobTitle,
          contractType: input.employmentType,
          workLocation: input.workLocation,
          personalEmail: input.personalEmail,
          personalPhone: input.phone,
          nationality: input.nationality,
        },
        { userId: null, managerId: input.managerId },
      ),
      select: { id: true },
    });
    const kase = await tx.jmlCase.create({
      data: {
        caseRef: `${DRAFT_REF_PREFIX}${randomBytes(8).toString("hex")}`,
        caseType: "JOIN",
        status: "DRAFT",
        stage: "PREBOARDING",
        employeeId: employee.id,
        lastUpdatedById: actor.userId,
      },
      select: { id: true },
    });
    await tx.jmlJoinDetail.create({
      data: { ...detailData(input), caseId: kase.id, payrollApplicable },
      select: { caseId: true },
    });
    return kase.id;
  });
  return serializeJoiner(await loadJoinerRow(caseId), actor);
}

const DETAIL_KEYS = [
  "contractTypeId",
  "plannedStartDate",
  "contractStartDate",
  "contractEndDate",
  "probationMonths",
  "payrollApplicable",
  "clientAssignedRole",
  "introSentence",
  "hobbies",
  "msAccountRequired",
  "laptopRequired",
  "accessCardRequired",
] as const;

export function detailData(input: Partial<Record<(typeof DETAIL_KEYS)[number], unknown>>) {
  const data: Record<string, unknown> = {};
  for (const key of DETAIL_KEYS) if (input[key] !== undefined) data[key] = input[key];
  return data as Prisma.JmlJoinDetailUncheckedUpdateInput &
    Prisma.JmlJoinDetailUncheckedCreateInput;
}

/** Load a joiner the actor may manage, or 404/403/409. */
export async function loadJoinerForEdit(actor: JmlActor, caseId: string): Promise<JoinerRow> {
  const row = await loadJoinerRow(caseId);
  const subject = joinerSubject(row.employee);
  if (!canFor(actor, "jml.view", subject)) throw new JmlError("Joiner not found", 404);
  requireManage(actor, subject);
  if (row.status === "CANCELLED" || row.status === "ARCHIVED" || row.anonymisedAt) {
    throw new JmlError("This case is closed, so its joiner can no longer be edited.", 409);
  }
  return row;
}

/**
 * Discard a draft (D10): the case and — unless another module supplied it
 * (Hiring) — its pre-joiner are soft-deleted together, restorable from the bin.
 */
export async function discardDraft(actor: JmlActor, caseId: string) {
  const row = await loadJoinerForEdit(actor, caseId);
  if (row.status !== "DRAFT") {
    throw new JmlError("Only a draft can be discarded; cancel an active onboarding instead.", 409);
  }
  await auditedTransaction(async (tx) => {
    await tx.jmlCase.delete({ where: { id: caseId }, select: { id: true } });
    const ownedHere = !row.joinDetail?.sourceRef && row.employee.status === "PRE_JOINER";
    if (ownedHere) {
      await tx.employee.delete({ where: { id: row.employee.id }, select: { id: true } });
    }
  });
  return { discarded: true };
}
