import type { AssignmentStatus, CycleStatus, ThreeSixtyStatus } from "@/generated/prisma/client";

/**
 * §9.4/§9.7 — may HR change THIS about a 360 cycle right now, and if not, why?
 *
 * Its own module for the reason `three-sixty-answer.ts` is: the READ that
 * decides whether to render a control and the WRITE that accepts it must not
 * disagree. A button the route then refuses is the worst outcome — HR types out
 * an intention and loses it at the click — and this screen already had the
 * inverse of that bug, a §12.1 departure dialog promising that a leaver's 360
 * assignments "will need a new rater" when no writer in the product would
 * accept a rater change on a live cycle.
 *
 * Everything here is a pure predicate over state the caller already holds, so
 * the page and the handler can ask the same question without a second query.
 */

export type EditRefusal = { reason: string; status: 409 | 422 };

/** §2 — a finished performance year's 360 is part of the record. */
function yearClosed(performanceYearStatus: CycleStatus): EditRefusal | null {
  if (performanceYearStatus === "CLOSED") {
    return { reason: "A closed performance year's 360 cannot be amended (§2).", status: 409 };
  }
  return null;
}

/**
 * Why HR may not move this cycle's window to these dates, or null.
 *
 * ## The rule, and why it is not simply "draft only"
 *
 * It WAS draft only: the amend ran `where: { status: "DRAFT" }` and told HR
 * "the window is fixed once the cycle is activated (§9.7) — raters have already
 * been told when it closes". That reasoning is sound for bringing a deadline
 * FORWARD and wrong for pushing it back, and the build treated both as one act.
 * A cycle that needed another week was simply over, with nothing in the product
 * able to say otherwise.
 *
 * So the direction is what matters once raters are inside:
 *
 *  - **Later is allowed.** Extending cannot invalidate an answer anybody has
 *    already given, and §9.7's reminders read the deadline live, so the people
 *    still working get a longer run at it. This is the operator's actual ask.
 *  - **Earlier is refused.** §5.4 makes a passed deadline a hard lock, so
 *    pulling one forward locks raters out of forms they are part-way through —
 *    a different act from fixing a typo, and not one §9 asks for.
 *  - **`opensAt` freezes once it has passed**, for the same reason: raters can
 *    already be inside. Before it opens it still moves freely, because nobody
 *    can have started.
 */
export function windowChangeBlockedReason(params: {
  cycleStatus: ThreeSixtyStatus;
  performanceYearStatus: CycleStatus;
  currentOpensAt: Date;
  nextOpensAt: Date;
  nextDeadline: Date;
  currentDeadline: Date;
  now: Date;
}): EditRefusal | null {
  const {
    cycleStatus,
    performanceYearStatus,
    currentOpensAt,
    nextOpensAt,
    nextDeadline,
    currentDeadline,
    now,
  } = params;

  const closed = yearClosed(performanceYearStatus);
  if (closed) return closed;

  if (nextDeadline <= nextOpensAt) {
    return { reason: "The deadline must fall after the cycle opens.", status: 422 };
  }

  // A draft has told nobody anything yet, so both dates move in both directions.
  if (cycleStatus === "DRAFT") return null;

  if (cycleStatus === "CLOSED") {
    return {
      reason: "This 360 cycle is closed. Reopen it first if the window needs to change (§9.8).",
      status: 409,
    };
  }

  // ACTIVE from here down.
  if (nextDeadline < currentDeadline) {
    return {
      reason:
        "The deadline can be extended but not brought forward on a live cycle: raters have been " +
        "told when it closes, and a passed deadline locks their form (§5.4). Close the cycle " +
        "instead if it should end now.",
      status: 409,
    };
  }
  if (currentOpensAt <= now && nextOpensAt.getTime() !== currentOpensAt.getTime()) {
    return {
      reason:
        "This cycle has already opened, so its opening date cannot change (§9.7) — raters may " +
        "be part-way through. The deadline can still be extended.",
      status: 409,
    };
  }
  return null;
}

/**
 * Why HR may not move this cycle to `next`, or null.
 *
 * Four transitions are real, and they are deliberately NOT a toggle:
 *
 *  - `ACTIVE → CLOSED` — **close**. §9.8's results stand and no further
 *    responses are accepted. `answerBlockedReason` has refused raters on a
 *    closed cycle since before anything could set it; this is what finally
 *    writes the column.
 *  - `ACTIVE → DRAFT` — **deactivate**, for a cycle launched by mistake. Only
 *    while NOTHING has been submitted: back in draft the bulk regenerate will
 *    wipe every assignment, and that must not be able to destroy a submitted
 *    assessment as a side effect.
 *  - `CLOSED → ACTIVE` — **reopen**. Allowed on purpose. A close nobody can
 *    undo is the dead end this product has now produced twice (the §12.1
 *    reinstatement refusal was the other), and an HR user who closes a cycle a
 *    day early should not need a developer.
 *  - `CLOSED → DRAFT` — refused as two decisions at once; reopen, then
 *    deactivate, so each gets its own confirmation and its own audit row.
 *
 * §9.7's launch (`DRAFT → ACTIVE`) stays with `/api/three-sixty/activate`,
 * which carries the exactly-three gate this function has no business repeating.
 */
export function statusChangeBlockedReason(params: {
  current: ThreeSixtyStatus;
  next: ThreeSixtyStatus;
  performanceYearStatus: CycleStatus;
  submittedCount: number;
}): EditRefusal | null {
  const { current, next, performanceYearStatus, submittedCount } = params;

  const closed = yearClosed(performanceYearStatus);
  if (closed) return closed;

  if (current === next) {
    return { reason: `This 360 cycle is already ${next.toLowerCase()}.`, status: 409 };
  }

  if (next === "ACTIVE" && current === "DRAFT") {
    return {
      reason:
        "Use Activate to launch a draft cycle — §9.7 checks that every employee has exactly " +
        "three raters first.",
      status: 409,
    };
  }

  if (next === "DRAFT") {
    if (current === "CLOSED") {
      return {
        reason:
          "Reopen this cycle first, then deactivate it — they are two separate decisions and " +
          "each is recorded on its own.",
        status: 409,
      };
    }
    if (submittedCount > 0) {
      return {
        reason:
          `${submittedCount} assessment(s) have already been submitted, so this cycle cannot go ` +
          "back to draft — regenerating assignments from a draft would delete them. Close the " +
          "cycle instead.",
        status: 409,
      };
    }
  }

  return null;
}

/**
 * Why HR may not change the rater on this assignment, or null.
 *
 * ## Submitted means locked, and discarding is a different act
 *
 * The operator's own suggestion was that a submitted assessment be locked and
 * reassignable "only with a mandatory logged reason". Locked: yes. Reassigned:
 * never — pointing somebody else's answers at a new name is not a reassignment,
 * it is a falsified assessment, and §9.3's scores are what §8.5 carries into
 * pay. The remedy for a submitted assessment that should not count is to
 * DISCARD it, with a reason, which `discardBlockedReason` governs: the answers
 * come out of §9.5's average and go into the audit row instead of being
 * silently re-attributed.
 */
export function raterChangeBlockedReason(params: {
  cycleStatus: ThreeSixtyStatus;
  performanceYearStatus: CycleStatus;
  assignmentStatus: AssignmentStatus;
}): EditRefusal | null {
  const { cycleStatus, performanceYearStatus, assignmentStatus } = params;

  const closed = yearClosed(performanceYearStatus);
  if (closed) return closed;

  if (cycleStatus === "CLOSED") {
    return {
      reason: "This 360 cycle is closed (§9.8). Reopen it first if its raters must change.",
      status: 409,
    };
  }
  if (assignmentStatus === "SUBMITTED") {
    return {
      reason:
        "This assessment has already been submitted, so its rater cannot be changed — the " +
        "answers belong to the person who gave them. Discard it with a reason instead, and the " +
        "replacement rater starts from a blank form.",
      status: 409,
    };
  }
  return null;
}

/**
 * Why HR may not discard this assignment, or null.
 *
 * Unsubmitted: removing it is ordinary §9.4 management. Submitted: the answers
 * are destroyed (`AssignmentResponse` cascades), so the caller MUST supply a
 * reason and MUST copy the answers into the audit row before deleting. That
 * requirement is stated here, next to the rule, rather than left to each route
 * to remember.
 */
export function discardBlockedReason(params: {
  cycleStatus: ThreeSixtyStatus;
  performanceYearStatus: CycleStatus;
  assignmentStatus: AssignmentStatus;
  reason: string | null | undefined;
}): EditRefusal | null {
  const { cycleStatus, performanceYearStatus, assignmentStatus, reason } = params;

  const closed = yearClosed(performanceYearStatus);
  if (closed) return closed;

  if (cycleStatus === "CLOSED") {
    return {
      reason: "This 360 cycle is closed (§9.8). Reopen it first if its assignments must change.",
      status: 409,
    };
  }
  if (assignmentStatus === "SUBMITTED" && !reason?.trim()) {
    return {
      reason:
        "Discarding a submitted assessment deletes the answers, so a reason is required — it is " +
        "recorded on the audit trail with what was discarded.",
      status: 422,
    };
  }
  return null;
}

/**
 * Does discarding this assignment destroy answers? Drives both the confirmation
 * HR reads and the audit row the route writes, so the two cannot disagree about
 * whether anything was lost.
 */
export function discardDestroysAnswers(assignmentStatus: AssignmentStatus): boolean {
  return assignmentStatus === "SUBMITTED";
}
