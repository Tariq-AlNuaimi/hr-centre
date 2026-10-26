import type { HiringRequisition, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { can, type HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { isLiveUser } from "./people";
import { canRaiseRequisition } from "./planning-rules";
import { requisitionSubject } from "./scope";
import type {
  CreateHiringRequestInput,
  UpdateRequisitionInput,
} from "@/lib/validations/hiring/requisition";

/**
 * Requisition writes (Interview Hub `POST /api/positions`, `POST /api/hiring-requests`,
 * `PUT /api/positions/[id]`). Every write checks the TARGET company is in the
 * actor's `hiring.manage` scope — Interview Hub's POST checked nothing (D-entity).
 */

/** The company + department exist, agree, and are inside the actor's manage scope. */
export async function assertPlacement(
  actor: HiringActor,
  entityId: string,
  departmentId: string | null,
) {
  const entity = await prisma.orgEntity.findFirst({
    where: { id: entityId, deletedAt: null },
    select: { id: true },
  });
  if (!entity) throw new HiringRuleError("That company does not exist.", 400);
  if (departmentId) {
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
      select: { entityId: true },
    });
    if (!dept || dept.entityId !== entityId) {
      throw new HiringRuleError("That department is not part of the chosen company.", 400);
    }
  }
  const subject = await requisitionSubject({ entityId, departmentId });
  if (!can(actor, "hiring.manage", subject)) {
    throw new HiringRuleError("You can only raise hiring requests for a company you manage.", 403);
  }
}

async function assertPeople(ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (id && !(await isLiveUser(id)))
      throw new HiringRuleError("A chosen person no longer has an account.", 400);
  }
}

/** The JD-template-driven form: a DRAFT with its JD already written. */
export async function createRequisition(
  actor: HiringActor,
  data: Omit<Prisma.HiringRequisitionUncheckedCreateInput, "status">,
): Promise<HiringRequisition> {
  await assertPlacement(actor, data.entityId, data.departmentId ?? null);
  await assertPeople([data.hiringManagerId, data.ownerId]);
  return auditedTransaction(async (tx) => {
    const req = await tx.hiringRequisition.create({
      data: { ...data, status: "DRAFT", jdAuthorId: actor.userId },
    });
    await tx.hiringRequisitionStatusHistory.create({
      data: {
        requisitionId: req.id,
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        changedById: actor.userId,
        reason: "Requisition created.",
      },
    });
    return req;
  });
}

/** Step 1: the hiring request (draft, or draft + submit in one transaction). */
export async function createHiringRequest(actor: HiringActor, input: CreateHiringRequestInput) {
  const r = input.request;
  await assertPlacement(actor, r.entityId, r.departmentId ?? null);
  await assertPeople([r.hiringManagerId]);
  if (!r.hiringManagerId)
    throw new HiringRuleError("Choose the hiring manager before saving.", 400);
  const needId = r.departmentNeedId ? await raisableNeed(actor, r.departmentNeedId) : null;
  const note = input.mode === "submit" ? input.note : null;
  return auditedTransaction(async (tx) => {
    const req = await tx.hiringRequisition.create({
      data: {
        title: r.title,
        entityId: r.entityId,
        departmentId: r.departmentId ?? null,
        hiringManagerId: r.hiringManagerId!,
        openings: r.openings ?? 1,
        targetCloseDate: r.targetCloseDate ?? null,
        salaryCurrency: r.salaryCurrency,
        salaryBandMin: r.salaryBandMin ?? null,
        salaryBandMax: r.salaryBandMax ?? null,
        businessNeed: r.businessNeed ?? null,
        alternativesConsidered: r.alternativesConsidered ?? null,
        departmentNeedId: needId,
        status: note ? "PENDING_APPROVAL" : "DRAFT",
      },
    });
    await tx.hiringRequisitionStatusHistory.create({
      data: {
        requisitionId: req.id,
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        changedById: actor.userId,
        reason: needId
          ? "Hiring request created from the departmental workforce plan."
          : "Hiring request created.",
      },
    });
    if (note) {
      await tx.hiringRequisitionStatusHistory.create({
        data: {
          requisitionId: req.id,
          fromStatus: "DRAFT",
          toStatus: "PENDING_APPROVAL",
          changedById: actor.userId,
          reason: note,
        },
      });
    }
    return req;
  });
}

async function raisableNeed(actor: HiringActor, needId: string): Promise<string> {
  const need = await prisma.hiringDepartmentNeed.findUnique({
    where: { id: needId },
    select: {
      id: true,
      status: true,
      rolesRequested: true,
      agreedRoles: true,
      departmentId: true,
      round: { select: { entityId: true } },
    },
  });
  const subject = need
    ? await requisitionSubject({ entityId: need.round.entityId, departmentId: need.departmentId })
    : null;
  if (!need || !subject || !can(actor, "hiring.manage", subject))
    throw new HiringRuleError("Department need not found", 404);
  const gate = canRaiseRequisition(need);
  if (!gate.ok) throw new HiringRuleError(gate.reason, 422);
  return need.id;
}

const LOCKED_AFTER_DRAFT = ["title"] as const;
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Edit. After DRAFT the title and the approved openings are frozen (they are
 * what headcount approval approved — the sanctioned path is "send it back to
 * draft"). The JD text and competencies stay editable: they are governed by the
 * JD sign-off, and an edit while awaiting sign-off or approved voids the
 * signatures (D15 — Interview Hub froze them too, which left a requisition
 * raised through the hiring request with no way to ever write its JD).
 */
export async function updateRequisition(
  actor: HiringActor,
  existing: HiringRequisition,
  data: UpdateRequisitionInput,
) {
  if (existing.status !== "DRAFT") {
    const locked = LOCKED_AFTER_DRAFT.filter(
      (f) => data[f] !== undefined && !sameValue(data[f], existing[f]),
    );
    if (locked.length || (data.openings !== undefined && data.openings !== existing.openings)) {
      throw new HiringRuleError(
        "This requisition has left draft, so its title and openings are part of what was approved. Send it back to draft to change them.",
        409,
      );
    }
  }
  if (data.entityId || data.departmentId !== undefined) {
    await assertPlacement(
      actor,
      data.entityId ?? existing.entityId,
      data.departmentId ?? existing.departmentId,
    );
  }
  await assertPeople([data.hiringManagerId, data.ownerId]);
  const jdChanged = (["description", "competencies"] as const).some(
    (f) => data[f] !== undefined && !sameValue(data[f], existing[f]),
  );
  const voids =
    jdChanged && (existing.jdStatus === "AWAITING_SIGNOFF" || existing.jdStatus === "APPROVED");
  return prisma.hiringRequisition.update({
    where: { id: existing.id },
    data: voids
      ? {
          ...data,
          jdStatus: "DRAFT",
          jdVersion: { increment: 1 },
          jdApprovedAt: null,
          jdAuthorId: actor.userId,
        }
      : data,
  });
}
