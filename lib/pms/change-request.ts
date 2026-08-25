import { Prisma } from "@/generated/prisma/client";
import type { ChangeRequestStatus } from "@/generated/prisma/client";
import type { CycleStageKind, RoleTrack } from "@/generated/prisma/client";
import { canActOnEmployee, isHr, type PmsActor } from "./permissions";
import { canActOnStage, isGoalSettingExempt, type StageWindow } from "./cycle";
import { REQUIRED_TOTAL, weightageTotal, type WeightedKpi } from "./kpi";

/**
 * §6 — mid-year KPI change requests.
 *
 * This module is the shared seam for a rule the spec states once and the system
 * has to honour in three places: the manager's submit, HR's approve, and the
 * screen that shows either of them why they cannot proceed.
 *
 * ## The rule that shapes everything here
 *
 * §6.2 says "if a KPI needs adjusting, the manager submits a change request" —
 * singular. But §5.3 requires weightages to total **exactly 100**, so changing
 * one weightage necessarily breaks the set. A request therefore carries SEVERAL
 * edits and is approved or rejected as a unit, and approval is refused unless
 * the resulting set totals exactly 100.
 *
 * The alternative — one KPI per request — lets the HR-approved baseline sit at
 * 90% for weeks, because §5.3 only bites at sign-off and mid-year has none. The
 * invariant would be aspirational rather than true.
 *
 * ## Nothing here writes
 *
 * Every function is pure. The transaction that archives, updates and decides
 * lives in the route, because it is one atomic act and splitting it across a
 * module boundary is how half of it eventually ships without the other half.
 */

/**
 * §6's window. §2 puts the mid-year review in June/July with **no scoring**, and
 * §6.1 is explicit that a change request is raised "during the mid-year review"
 * — so the stage that gates a request is MID_YEAR, not the goal-setting stage
 * that produced the baseline.
 */
export const MID_YEAR_STAGE: CycleStageKind = "MID_YEAR";

/** The six §5.2 fields a change may touch, plus the ordering. */
export const EDITABLE_FIELDS = [
  "description",
  "weightage",
  "descriptorOutstanding",
  "descriptorExcellent",
  "descriptorTarget",
  "descriptorAlmostAchieved",
  "descriptorUnsatisfactory",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** A KPI's current state, as much of it as this module needs. */
export type KpiState = {
  id: string;
  description: string;
  weightage: Prisma.Decimal | string | number;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
};

/**
 * A proposed change to one KPI. **A null or absent field means "unchanged"** —
 * that is how §6.2's partial change ("descriptors/metrics only") is expressed,
 * as against a full overhaul where every field is present.
 */
export type KpiEdit = {
  kpiId: string;
  description?: string | null;
  weightage?: Prisma.Decimal | string | number | null;
  descriptorOutstanding?: string | null;
  descriptorExcellent?: string | null;
  descriptorTarget?: string | null;
  descriptorAlmostAchieved?: string | null;
  descriptorUnsatisfactory?: string | null;
};

/** The state a KPI would have if the edit were applied. Pure; nothing written. */
export function applyEdit(kpi: KpiState, edit: KpiEdit | undefined): KpiState {
  if (!edit) return kpi;
  const next = { ...kpi };
  for (const field of EDITABLE_FIELDS) {
    const proposed = edit[field];
    if (proposed !== undefined && proposed !== null) {
      (next as Record<string, unknown>)[field] = proposed;
    }
  }
  return next;
}

/**
 * §5.3's total for the set AS IT WOULD BE if this request were approved.
 *
 * Decimal, not float, for the same reason the live total is: the comparison is
 * against exactly 100, and three 33.33s are not 100 in binary floating point.
 */
export function proposedWeightageTotal(
  kpis: readonly KpiState[],
  edits: readonly KpiEdit[],
): Prisma.Decimal {
  const byKpi = new Map(edits.map((e) => [e.kpiId, e]));
  return weightageTotal(kpis.map((k) => applyEdit(k, byKpi.get(k.id)) as WeightedKpi));
}

/** §6.3 — what actually changed, field by field. Empty when nothing did. */
export function fieldChanges(
  before: KpiState,
  after: KpiState,
): Partial<Record<EditableField, { from: string; to: string }>> {
  const changes: Partial<Record<EditableField, { from: string; to: string }>> = {};
  for (const field of EDITABLE_FIELDS) {
    const from = String(before[field]);
    const to = String(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

export type ChangeRequestRefusal = { reason: string; status: 403 | 404 | 409 };

/**
 * Why this actor may not SUBMIT a change request here, or null when they may.
 *
 * Checked in the order a person would ask: is it your report, is the stage open,
 * and is there an agreed baseline to change at all. §6 adjusts a baseline;
 * before HR's §5.1 approval there is nothing to adjust — the manager is still
 * drafting, and drafting has its own route.
 *
 * 404 rather than 403 when the actor has no relationship to the employee, the
 * same existence-oracle rule the rest of the system uses (§4.2).
 */
export function submitBlockedReason(params: {
  actor: PmsActor;
  target: { id: string; managerId: string | null };
  stage: StageWindow | null;
  now: Date;
  goalsApprovedAt: Date | null;
}): ChangeRequestRefusal | null {
  const { actor, target, stage, now, goalsApprovedAt } = params;

  if (!canActOnEmployee(actor, target)) {
    return { reason: "Participant not found", status: 404 };
  }
  if (goalsApprovedAt === null) {
    return {
      reason:
        "This KPI set has no HR-approved baseline yet, so there is nothing to change (§5.1). " +
        "It is still in goal-setting.",
      status: 409,
    };
  }
  if (stage === null) {
    return { reason: "This cycle has no mid-year stage configured yet (§2).", status: 409 };
  }
  if (!canActOnStage(stage, now)) {
    return {
      reason:
        now < stage.opensAt
          ? "The mid-year review has not opened yet for this cycle (§2)."
          : "The mid-year deadline has passed and the stage is locked (§5.4).",
      status: 409,
    };
  }
  return null;
}

/**
 * §6.2 — why HR may not DECIDE this request, or null.
 *
 * Deliberately does NOT check the stage window. §5.4 locks the party who owns an
 * action out of it; HR owns the cycle, and a request left pending when the
 * deadline passes still has to be resolvable — otherwise it sits PENDING for
 * ever and §6.3's history records a question nobody ever answered.
 */
export function decideBlockedReason(params: {
  actor: PmsActor;
  status: ChangeRequestStatus;
}): ChangeRequestRefusal | null {
  const { actor, status } = params;

  if (!isHr(actor)) {
    return { reason: "Only HR reviews and decides change requests (§6.2).", status: 403 };
  }
  if (status !== "PENDING") {
    return {
      reason: `This request was already ${status.toLowerCase()} — a decision is made once (§6.2).`,
      status: 409,
    };
  }
  return null;
}

/**
 * §5.3 — why an APPROVAL cannot go through, or null when it can.
 *
 * Separate from `decideBlockedReason` because a rejection has no weightage
 * question to answer: refusing a change leaves the set exactly as it was, and a
 * set that is already valid stays valid.
 */
export function approvalBlockedReason(params: {
  kpis: readonly KpiState[];
  edits: readonly KpiEdit[];
}): string | null {
  const { kpis, edits } = params;

  const unknown = edits.filter((e) => !kpis.some((k) => k.id === e.kpiId));
  if (unknown.length > 0) {
    return (
      "This request edits a KPI that is no longer in the set — it was withdrawn after the " +
      "request was raised. Reject it and ask for a fresh one."
    );
  }

  const total = proposedWeightageTotal(kpis, edits);
  if (total.equals(REQUIRED_TOTAL)) return null;

  const gap = total.minus(REQUIRED_TOTAL);
  return gap.isNegative()
    ? `Approving this would leave weightages at ${total}% — ${gap.abs()}% short of the 100% ` +
        `§5.3 requires. Ask the manager to rebalance the whole set in one request.`
    : `Approving this would leave weightages at ${total}% — ${gap}% over the 100% §5.3 allows. ` +
        `Ask the manager to rebalance the whole set in one request.`;
}

/**
 * Who may withdraw: the manager who raised it, or HR.
 *
 * A withdrawal is a STATUS, never a delete — §6.3 wants the history of what was
 * asked, not only of what was approved.
 */
export function withdrawBlockedReason(params: {
  actor: PmsActor;
  requestedByEmployeeId: string;
  status: ChangeRequestStatus;
}): ChangeRequestRefusal | null {
  const { actor, requestedByEmployeeId, status } = params;

  const isRequester = actor.employeeId !== null && actor.employeeId === requestedByEmployeeId;
  if (!isRequester && !isHr(actor)) {
    return { reason: "Change request not found", status: 404 };
  }
  if (status !== "PENDING") {
    return {
      reason: `This request was already ${status.toLowerCase()} and cannot be withdrawn (§6.2).`,
      status: 409,
    };
  }
  return null;
}

/**
 * The full gate on raising a request, in the order a person would ask it —
 * the §6 counterpart to `kpiSetAccessRefusal` in `kpi.ts`.
 *
 * Kept beside `submitBlockedReason` rather than inlined into the route so the
 * submit route, the manager's screen and any later caller give the SAME sentence
 * for the same refusal. A screen that says "the mid-year window is closed" while
 * the route says "not found" is a screen people stop believing.
 */
export function changeRequestAccessRefusal(params: {
  actor: PmsActor;
  visible: boolean;
  employee: { id: string; managerId: string | null; roleTrack: RoleTrack };
  cycleStatus: string;
  stage: StageWindow | null;
  goalsApprovedAt: Date | null;
  now: Date;
}): ChangeRequestRefusal | null {
  const { actor, visible, employee, cycleStatus, stage, goalsApprovedAt, now } = params;

  // §4.2 — visibility first, and 404 rather than 403, so a participant id cannot
  // be probed for existence from outside the actor's chain.
  if (!visible) return { reason: "Participant not found", status: 404 };

  // §8.3 — C-Level skip goal-setting entirely, so there is no baseline of theirs
  // for §6 to amend. Categorical, answered before any timing question.
  if (isGoalSettingExempt(employee.roleTrack)) {
    return {
      reason:
        "C-Level employees skip goal-setting entirely (§8.3) — this participant has no KPI " +
        "baseline to change.",
      status: 409,
    };
  }

  // §2 — the year has to be running.
  if (cycleStatus !== "OPEN") {
    return {
      reason: `Change requests are raised while the cycle is open — this cycle is ${cycleStatus} (§2).`,
      status: 409,
    };
  }

  return submitBlockedReason({ actor, target: employee, stage, now, goalsApprovedAt });
}
