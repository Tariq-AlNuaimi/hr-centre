import type { PmsActor } from "@/lib/core/permissions";
import { isHr } from "@/lib/core/permissions";

/**
 * §12.1/§12.2 — what happens to a departing manager's reports, and the prompt
 * that stops the answer from being permanent by accident.
 *
 * §12.1: "Direct reports auto-roll-up one level (to the departed manager's own
 * manager) UNTIL HR reassigns a permanent manager."
 * §12.2: "HR gets a visible prompt for temporary roll-ups ('reports temporarily
 * rolled up — needs a permanent manager') so they don't silently persist."
 *
 * The roll-up is automatic; the resolution is not. That asymmetry is the whole
 * design: the org chart must never have a gap (§7.2's manager-of-record has to
 * resolve to somebody, or nobody can sign), but a chart repaired by machine must
 * announce itself, or it becomes the new normal without anyone deciding it did.
 *
 * Pure. The route owns the reads and the writes.
 */

/** The spec's own words, as a key the UI renders. §12.2's prompt text. */
export const ROLL_UP_PROMPT_KEY = "temporarilyRolledUp";

/**
 * ONE level up, not to the top.
 *
 * §12.1 says "one level (to the departed manager's own manager)". Walking
 * further — to the first non-leaver ancestor — would look more helpful and be
 * wrong: it silently reassigns people across two levels of the org, and if that
 * grandparent has also left, the correct answer is a prompt for HR rather than a
 * longer walk. Null when the departed manager was themselves the top of the
 * tree, which is the case HR most needs to see.
 */
export function rollUpTarget(departedManager: { managerId: string | null }): string | null {
  return departedManager.managerId;
}

/**
 * Who may resolve a roll-up prompt.
 *
 * §12.2 says HR reassigns. Both HR roles, not Super Admin alone: naming a
 * permanent manager is ordinary people-administration, and §10.6's Super
 * Admin-only carve-out is about calibration, not the org chart.
 */
export function canResolveRollUp(actor: PmsActor): boolean {
  return isHr(actor);
}

export type RollUpState = {
  resolvedAt: Date | null;
  toManagerEmployeeId: string | null;
};

export function resolveBlockedReason(params: {
  actor: PmsActor;
  rollUp: RollUpState;
  newManagerEmployeeId: string | null;
  subjectEmployeeId: string;
}): { reason: string; status: 403 | 409 | 400 } | null {
  const { actor, rollUp, newManagerEmployeeId, subjectEmployeeId } = params;
  if (!canResolveRollUp(actor)) {
    return { reason: "Only HR reassigns a permanent manager.", status: 403 };
  }
  if (rollUp.resolvedAt !== null) {
    return { reason: "This roll-up has already been resolved.", status: 409 };
  }
  if (newManagerEmployeeId === subjectEmployeeId) {
    return { reason: "An employee cannot be their own manager.", status: 400 };
  }
  return null;
}

/**
 * §12.2 — "The new manager INHERITS existing signed KPIs and picks up from
 * wherever things stand — no re-drafting of the baseline. Already-signed work
 * stays locked and valid."
 *
 * Stated as a predicate so the claim is testable and so no route can quietly
 * decide otherwise. It returns false unconditionally: there is no circumstance
 * in which a manager change invalidates a signature. §5.1's lock belongs to HR's
 * approval, and §7.2 makes the SIGNER a recorded fact rather than a derived one,
 * so a changed relationship cannot retroactively unsign anything.
 */
export function managerChangeInvalidatesSignatures(): boolean {
  return false;
}
