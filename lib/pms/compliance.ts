import type { ComplianceKind, EmployeeStatus, RoleTrack } from "@/generated/prisma/client";
import {
  hoursOverdue,
  isGoalSettingExempt,
  isPastGrace,
  stageState,
  type StageWindow,
} from "./cycle";
import { EMPLOYEE_DID_NOT_SIGN, EMPLOYEE_SIGNED_MANAGER_DID_NOT } from "./signoff";

/**
 * §5.5's escalation ladder and §5.6's compliance record, as a PURE decision.
 *
 * The single most important thing in this file is the ORDER of §5.5's rungs:
 *
 *   > "Approaching deadline → escalating reminders to the manager. Deadline
 *   > missed → skip-level manager AND HR notified in parallel; compliance
 *   > logging begins. Still unresolved after the grace window → HR intervenes
 *   > formally."
 *
 * Skip-level and HR are notified **the moment the deadline passes**, in the
 * same run, in parallel with each other. The grace window runs AFTER that
 * moment and gates only the THIRD rung — HR's formal intervention (extend,
 * intervene, or mark non-compliant). Reading it the other way round — waiting
 * out the grace window before escalating — delays every escalation by the grace
 * length and quietly defeats the ladder, which is why `isPastGrace` appears in
 * exactly one function here (`hrInterventionDue`) and nowhere in
 * `ladderEventsFor`.
 *
 * Nothing in this file touches the database or the clock. `now` is a parameter
 * for the same reason it is one in cycle.ts: a deadline system that can only be
 * tested on the day it fires is a deadline system that is never tested.
 */

/** Everything the ladder needs to know about one participant, at one instant. */
export type ParticipantComplianceState = {
  subjectEmployeeId: string;
  /**
   * The manager of record RIGHT NOW (§12.2 — "whoever currently holds the
   * relationship at the time of each action"), never a snapshot. Null for the
   * top of a tree, which is why every consumer here handles null rather than
   * assuming an escalation target exists.
   */
  managerEmployeeId: string | null;
  roleTrack: RoleTrack;
  employeeStatus: EmployeeStatus;
  /** How many live KPIs the manager has drafted. Zero means "never drafted". */
  kpiCount: number;
  employeeSigned: boolean;
  managerSigned: boolean;
  /** §5.1 — HR approval is the lock, and therefore the definition of resolved. */
  goalsApproved: boolean;
  /**
   * When this person joined the CYCLE, not when they joined the company.
   *
   * §3.5 pulls new employees into an open cycle, so a participant can first
   * exist after a stage deadline has already passed — an import in March
   * against a December goal-setting deadline. Nothing about that is anyone's
   * failure, and the ladder needs to know it: see `isLadderExempt`.
   */
  enrolledAt: Date;
};

/** One row the sweep will try to write. `missedByHours` is §5.6's "by how long". */
export type LadderEvent = {
  kind: ComplianceKind;
  managerEmployeeId: string | null;
  missedByHours: number | null;
  detail: string;
};

/**
 * How close to a deadline counts as "approaching" (§5.5's first rung).
 *
 * Seven days, so a reminder lands with a working week still left to act in. The
 * spec says "escalating reminders" (plural) but the compliance record is unique
 * per (cycle, stage, subject, kind) — one REMINDER_SENT row per participant per
 * stage. That constraint is deliberate: §5.6's report answers "was this manager
 * reminded", not "how many emails did we send", and a row per day would inflate
 * a manager's record with the sweep's own cadence. Repeat NOTIFICATIONS are
 * free; repeat compliance ROWS are not.
 */
export const REMINDER_WINDOW_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;

/**
 * §8.3 (C-Level skip goal-setting entirely) and §12.1 (a leaver's "pending
 * actions close out" — no lingering Overdue). Both are exclusions from the
 * LADDER, not from the cycle: the participant row stays, because §11's
 * reporting still needs it.
 */
export function isLadderExempt(state: ParticipantComplianceState): boolean {
  return isGoalSettingExempt(state.roleTrack) || state.employeeStatus === "LEAVER";
}

/**
 * §5.5 — you cannot miss a deadline that passed before you were in the cycle.
 *
 * Until §3.5's enrolment actually ran after an import, this case could not
 * arise: every participant existed from the moment the cycle opened, so every
 * deadline was one they had been present for. Enrolling joiners mid-cycle makes
 * it ordinary, and without this the ladder reads a March joiner's empty KPI set
 * against a December deadline and escalates their MANAGER — `DEADLINE_MISSED`,
 * then skip-level, then HR, with `missedByHours` in the thousands — for work
 * §5.4's hard lock forbids them from doing. That is worse than the invisible
 * joiner it replaced: it is a false accusation on the §11.2 record, and nothing
 * short of HR extending the stage for the whole company clears it.
 *
 * Deliberately NOT a general "late joiners are exempt" rule. It is scoped to
 * the one stage whose deadline they were absent for; a joiner enrolled while
 * the window is still open is on the ladder like everybody else.
 */
export function enrolledAfterDeadline(
  state: ParticipantComplianceState,
  stage: StageWindow,
): boolean {
  return state.enrolledAt.getTime() > stage.deadline.getTime();
}

/** §5.1 — the lock IS the resolution. Nothing else closes a goal-setting file. */
function isResolved(state: ParticipantComplianceState): boolean {
  return state.goalsApproved;
}

function outstandingWork(state: ParticipantComplianceState): string[] {
  const items: string[] = [];
  if (state.kpiCount === 0) items.push("KPIs not drafted");
  if (!state.managerSigned) items.push("manager has not signed");
  if (!state.employeeSigned) items.push("employee has not signed");
  return items;
}

/**
 * The ladder, as a pure function of state + stage + instant.
 *
 * Returns the events this participant WARRANTS right now — not the events that
 * are new. Deciding what is new is the unique constraint's job (the sweep
 * catches P2002 and moves on), which keeps this function total and repeatable:
 * calling it twice with the same arguments returns the same answer, so a second
 * sweep in the same day cannot decide something different from the first.
 */
export function ladderEventsFor(
  state: ParticipantComplianceState,
  stage: StageWindow,
  now: Date,
): LadderEvent[] {
  if (isLadderExempt(state) || isResolved(state)) return [];
  if (enrolledAfterDeadline(state, stage)) return [];

  const phase = stageState(stage, now);
  if (phase === "NOT_YET_OPEN") return [];

  const manager = state.managerEmployeeId;

  if (phase === "OPEN") {
    const outstanding = outstandingWork(state);
    if (outstanding.length === 0) return [];

    const msToDeadline = stage.deadline.getTime() - now.getTime();
    if (msToDeadline > REMINDER_WINDOW_DAYS * 24 * HOUR_MS) return [];

    const hoursRemaining = Math.ceil(msToDeadline / HOUR_MS);
    return [
      {
        kind: "REMINDER_SENT",
        // §5.5's first rung is addressed "to the manager" — the record names
        // them even though nothing has been missed yet, so §11.2 can show a
        // manager was warned before they were escalated.
        managerEmployeeId: manager,
        missedByHours: null,
        detail: `Goal-setting closes in ${hoursRemaining}h; outstanding: ${outstanding.join("; ")}.`,
      },
    ];
  }

  // --- The deadline has passed. §5.5 rung two, in ONE run. ------------------
  const missedByHours = hoursOverdue(stage, now);

  // §5.4 — the employee let their own deadline pass. The manager drafted and
  // signed; nothing here is the manager's failure, and §5.4 puts the set into
  // HR review rather than onto anyone's compliance record. So: ONE row, with a
  // null manager. Attaching the manager's id would quietly cost them a miss in
  // §11.2's manager-accountability report for something they did on time.
  if (state.kpiCount > 0 && state.managerSigned && !state.employeeSigned) {
    return [
      {
        kind: "DEADLINE_MISSED",
        managerEmployeeId: null,
        missedByHours,
        detail: EMPLOYEE_DID_NOT_SIGN,
      },
    ];
  }

  const detail = managerSideDetail(state);
  if (detail === null) return [];

  // The three rungs of a missed MANAGER deadline, emitted together. Not staged
  // behind the grace window — §5.5 escalates "in parallel", and the skip-level
  // manager is the one with "authority to compel action", which is worth
  // nothing if they hear about it three days late.
  const rungs: ComplianceKind[] = manager
    ? ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"]
    : // No manager of record, so there is no skip-level to escalate TO. HR still
      // hears about it — the employee is blocked either way (§5.5's principle).
      ["DEADLINE_MISSED", "ESCALATED_HR"];

  return rungs.map((kind) => ({
    kind,
    managerEmployeeId: manager,
    missedByHours,
    detail,
  }));
}

/**
 * What the manager failed to do, or null when the miss is not theirs.
 *
 * The middle case's string is quoted from §5.5 and must stay EXACTLY as the
 * spec writes it: "employee signed, manager did not". It is a status HR reads,
 * not prose.
 */
function managerSideDetail(state: ParticipantComplianceState): string | null {
  if (state.kpiCount === 0) {
    return "Manager did not draft KPIs before the goal-setting deadline.";
  }
  if (!state.managerSigned && state.employeeSigned) {
    return EMPLOYEE_SIGNED_MANAGER_DID_NOT;
  }
  if (!state.managerSigned) {
    return "Neither party signed before the goal-setting deadline; the manager's sign-off is outstanding.";
  }
  // Manager drafted and signed, employee signed: the only thing left is HR's
  // own approval. That is not a compliance event against anybody.
  return null;
}

/**
 * §5.5 rung three — "still unresolved after the grace window → HR intervenes
 * formally (extend deadline, intervene directly, or mark formal
 * non-compliance)".
 *
 * This is deliberately NOT another `ComplianceEvent`: the three formal
 * interventions are HR's own acts (`HR_EXTENDED_DEADLINE`,
 * `HR_MARKED_NON_COMPLIANT`, or an edit), and a sweep that logged "HR should
 * intervene" would be recording its own opinion in the record that §11.2 reads
 * as fact. The sweep SURFACES these instead — they come back in the response
 * and in HR's notification — and the record stays a record of what happened.
 *
 * Note the resolution bar: HR approval. A set where both parties signed but HR
 * has not approved is still unresolved past the grace window — §5.4 moved it to
 * HR review, and the outstanding action is HR's own.
 */
export function hrInterventionDue(
  state: ParticipantComplianceState,
  stage: StageWindow,
  now: Date,
): boolean {
  if (isLadderExempt(state) || isResolved(state)) return false;
  return isPastGrace(stage, now);
}

/** A one-line summary of an unresolved file, for HR's intervention queue. */
export function interventionSummary(state: ParticipantComplianceState): string {
  const outstanding = outstandingWork(state);
  return outstanding.length === 0
    ? "Both parties signed; awaiting HR approval."
    : `Outstanding: ${outstanding.join("; ")}.`;
}
