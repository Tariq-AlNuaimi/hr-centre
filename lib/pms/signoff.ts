import type { CycleStatus, SignOffParty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canActOnEmployee, type PmsActor } from "./permissions";
import { GOAL_SETTING_STAGE, isWeightageComplete, type WeightedKpi } from "./kpi";
import { isGoalSettingExempt, stageState, type StageWindow } from "./cycle";

/**
 * Sign-off and HR approval — spec §5.1, §5.3, §5.4.
 *
 * Three facts from the spec shape this whole file, and each of them is a thing
 * the code must NOT have:
 *
 *   1. **There is no reject.** §5.3: "If the employee does not agree, they
 *      simply do not sign. There is no 'reject' button — the unsigned state is
 *      the signal." So there is no status, no DELETE, and no un-sign path. The
 *      absence of a `SignOff` row IS the disagreement.
 *   2. **A signature is not a lock.** §5.1 makes HR's approval the lock; both
 *      signatures are agreement. So signing never freezes a KPI set, and the
 *      approval check lives in `hrApprovalDecision`, not here.
 *   3. **Signing twice is not an error.** A double-tap, a retried request and a
 *      second browser tab must all mean "this party has signed", so the route
 *      reports the existing row rather than a 409. The unique constraint
 *      `@@unique([participantId, party])` is what makes that safe under a race.
 */

/** Which of §5.1's two parties have signed. Nothing else is representable. */
export type SignOffState = {
  employeeSigned: boolean;
  managerSigned: boolean;
};

export function signOffState(rows: readonly { party: SignOffParty }[]): SignOffState {
  return {
    employeeSigned: rows.some((r) => r.party === "EMPLOYEE"),
    managerSigned: rows.some((r) => r.party === "MANAGER"),
  };
}

export function isFullySigned(state: SignOffState): boolean {
  return state.employeeSigned && state.managerSigned;
}

/**
 * §5.4's status for an employee who let the deadline pass. Exported as a
 * constant because it is a STATUS the spec quotes, read by the compliance
 * ladder and by the approval response alike — two places that must never
 * paraphrase it differently.
 */
export const EMPLOYEE_DID_NOT_SIGN = "Employee did not sign";

/** §5.5's status for the mirror case, quoted verbatim from the spec. */
export const EMPLOYEE_SIGNED_MANAGER_DID_NOT = "employee signed, manager did not";

/**
 * §5.1/§4.2 — may THIS actor sign as THIS party? Null when they may.
 *
 * The two parties are asymmetric on purpose:
 *
 *   - EMPLOYEE is strictly the employee themselves. Not HR, not the manager,
 *     not a platform admin. §5.1 calls the signature an "acknowledgment of
 *     agreement", and an agreement someone else can record on your behalf is
 *     not one. This is the one place in the PMS where HR's §4.1 override is
 *     deliberately absent.
 *   - MANAGER goes through `canActOnEmployee`, which is §4.2's "editing and
 *     sign-off is always reserved for the direct line manager" — one edge, not
 *     the chain — with HR's documented override on top (§4.1).
 *
 * An actor with no employee record can sign nothing: the signature records
 * `signedByEmployeeId`, and §12.2 makes "who actually signed" the question
 * worth answering later.
 */
export function signerBlockedReason(params: {
  actor: PmsActor;
  party: SignOffParty;
  subject: { id: string; managerId: string | null };
}): string | null {
  const { actor, party, subject } = params;

  if (!actor.employeeId) {
    return "Only a linked employee record can sign; this account has none (ADR-065).";
  }
  if (party === "EMPLOYEE") {
    return actor.employeeId === subject.id
      ? null
      : "Only the employee themselves may sign their own KPI set (§5.1) — a signature is an acknowledgment of agreement, not an administrative act.";
  }
  return canActOnEmployee(actor, subject)
    ? null
    : "Only this employee's direct line manager may sign their KPI set (§4.2).";
}

/**
 * Why HR's approval — §5.1's LOCK — cannot be granted, or the basis on which it
 * can.
 *
 * The interesting branch is the second `allowed` one. §5.4 says an employee who
 * misses the deadline locks the set with the status "Employee did not sign" and
 * "the set moves to HR review". A set in HR review that HR could not approve
 * would be a dead end: the employee can no longer act (the stage is locked, and
 * §5.4 has no taper), so nobody could ever unblock the year. HR approving it is
 * the spec's own resolution, and the response says which basis was used so the
 * record shows an approval over an absent signature for what it is.
 *
 * What is NOT waived: the manager's signature. §5.4 makes the employee's
 * absence HR's problem to resolve; it says nothing of the kind about the
 * manager, whose miss §5.5 escalates instead. And §5.3's 100% rule binds the
 * lock explicitly — "KPIs cannot be signed off or locked unless individual KPI
 * weightages total exactly 100%" — so an incomplete set is refused even here.
 * HR's route past that is to extend the deadline (§5.5), which is an audited
 * act, not a quiet approval of a 95% set.
 */
export type HrApprovalBasis = "BOTH_SIGNED" | "HR_REVIEW_EMPLOYEE_UNSIGNED";

export type HrApprovalDecision =
  { allowed: true; basis: HrApprovalBasis; note: string } | { allowed: false; reason: string };

export function hrApprovalDecision(params: {
  state: SignOffState;
  stage: StageWindow;
  now: Date;
  kpis: readonly WeightedKpi[];
}): HrApprovalDecision {
  const { state, stage, now, kpis } = params;

  if (kpis.length === 0) {
    return { allowed: false, reason: "There are no KPIs to approve (§5.1)." };
  }
  if (!isWeightageComplete(kpis)) {
    return {
      allowed: false,
      reason:
        "Weightages must total exactly 100% before the set can be locked (§5.3). " +
        "If the stage has closed, extend the deadline (§5.5) rather than locking an incomplete set.",
    };
  }
  if (!state.managerSigned) {
    return {
      allowed: false,
      reason:
        "The line manager has not signed (§5.1). A missed manager sign-off escalates to the " +
        "skip-level manager and HR (§5.5); it is not waived by approval.",
    };
  }
  if (state.employeeSigned) {
    return {
      allowed: true,
      basis: "BOTH_SIGNED",
      note: "Both parties signed; HR approval locks the agreed baseline (§5.1).",
    };
  }
  if (stageState(stage, now) === "LOCKED") {
    return {
      allowed: true,
      basis: "HR_REVIEW_EMPLOYEE_UNSIGNED",
      note: `${EMPLOYEE_DID_NOT_SIGN} — the stage locked and the set moved to HR review (§5.4).`,
    };
  }
  return {
    allowed: false,
    reason:
      "The employee has not signed yet and the goal-setting stage is still open (§5.1). " +
      "Approval waits for their signature, or for the deadline to pass (§5.4).",
  };
}

/**
 * Everything both routes need about one participant, in one query.
 *
 * KPIs are fetched with an explicit `deletedAt: null`: `Kpi` carries soft-delete
 * columns but is NOT in the soft-delete extension's model set, and a nested
 * relation select would not be filtered even if it were (see the note in
 * lib/prisma/soft-delete-extension.ts). A deleted KPI counted toward the 100%
 * rule would let a set sign at a total the employee can no longer see.
 */
export type SignOffContext = {
  participant: {
    id: string;
    cycleId: string;
    employeeId: string;
    goalsApprovedAt: Date | null;
  };
  cycleStatus: CycleStatus;
  subject: { id: string; managerId: string | null };
  exempt: boolean;
  stage: StageWindow | null;
  kpis: WeightedKpi[];
  state: SignOffState;
};

export async function loadSignOffContext(participantId: string): Promise<SignOffContext | null> {
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      cycleId: true,
      employeeId: true,
      goalsApprovedAt: true,
      cycle: {
        select: {
          status: true,
          stages: {
            where: { kind: GOAL_SETTING_STAGE },
            select: { kind: true, opensAt: true, deadline: true, graceDays: true },
          },
        },
      },
      employee: { select: { id: true, managerId: true, roleTrack: true } },
      signOffs: { select: { party: true } },
    },
  });
  if (!participant) return null;

  const kpis = await prisma.kpi.findMany({
    where: { participantId, deletedAt: null },
    select: { weightage: true },
    // §5.2 KPI sets are a handful per employee; the cap is a guard, not a page.
    take: 200,
  });

  const stage = participant.cycle.stages[0] ?? null;

  return {
    participant: {
      id: participant.id,
      cycleId: participant.cycleId,
      employeeId: participant.employeeId,
      goalsApprovedAt: participant.goalsApprovedAt,
    },
    cycleStatus: participant.cycle.status,
    subject: { id: participant.employee.id, managerId: participant.employee.managerId },
    exempt: isGoalSettingExempt(participant.employee.roleTrack),
    stage,
    kpis,
    state: signOffState(participant.signOffs),
  };
}

/**
 * The shared preconditions both routes check before they even look at the
 * actor: a cycle that is actually running, a configured stage, and an employee
 * who has a goal-setting step at all (§8.3).
 */
export function contextBlockedReason(ctx: SignOffContext): string | null {
  if (ctx.cycleStatus !== "OPEN") {
    return ctx.cycleStatus === "DRAFT"
      ? "This performance cycle has not been opened yet (§5.1 — HR opens the cycle first)."
      : "This performance cycle is closed.";
  }
  if (ctx.exempt) {
    return "C-Level employees have no goal-setting step (§8.3).";
  }
  if (!ctx.stage) {
    return "This cycle has no goal-setting stage configured (§2).";
  }
  return null;
}
