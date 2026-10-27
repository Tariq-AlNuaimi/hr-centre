import type { AssignmentStatus, ThreeSixtyStatus } from "@/generated/prisma/client";

/**
 * §9.7's one question: may this rater answer this assignment right now?
 *
 * Its own module because `three-sixty.ts` crossed the complexity budget when it
 * moved in, and because the seam is real: everything else in that file is
 * §9.4's mapping and §9.5's arithmetic, while this is the gate the answering
 * screen and the write path both stand behind.
 */

export type AnswerRefusal = { reason: string; status: 409 };

/**
 * §9.7 — why this rater may not answer this assignment right now, or null.
 *
 * Extracted so the READ that renders the form and the WRITE that accepts it
 * cannot disagree. A form the UI happily renders and the route then refuses is
 * the worst of both: the rater types out an assessment and loses it at submit.
 * Identity is NOT decided here — `POST` answers "is this your assignment" with
 * a 404 (§4.2's convention: an assignment id must not reveal that a colleague
 * is being assessed), and that check stays at the boundary where the actor is.
 */
export function answerBlockedReason(params: {
  cycleStatus: ThreeSixtyStatus;
  opensAt: Date;
  deadline: Date;
  assignmentStatus: AssignmentStatus;
  now: Date;
}): AnswerRefusal | null {
  const { cycleStatus, opensAt, deadline, assignmentStatus, now } = params;

  if (cycleStatus !== "ACTIVE") {
    return {
      reason:
        cycleStatus === "DRAFT"
          ? "This 360 cycle has not been activated yet."
          : "This 360 cycle is closed.",
      status: 409,
    };
  }
  if (now < opensAt) {
    return { reason: "This 360 cycle has not opened yet.", status: 409 };
  }
  if (now > deadline) {
    // §5.4's convention, carried into §9: a deadline is a hard lock.
    return {
      reason: "The 360 deadline has passed and this assessment is locked.",
      status: 409,
    };
  }
  if (assignmentStatus === "SUBMITTED") {
    // §9.7 — "prevent duplicate submissions per assignment".
    return { reason: "This assessment has already been submitted.", status: 409 };
  }
  return null;
}
