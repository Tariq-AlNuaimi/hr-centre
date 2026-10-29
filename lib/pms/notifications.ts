import type { ComplianceKind, NotificationKind } from "@/generated/prisma/client";

// The store (feed owner, page size, body cap, the idempotent writer) lives in
// lib/core/notify/store.ts (ADR-091); the ladder's keys and kinds stay here.

/**
 * The in-app half of §5.5's ladder — who is told what, and how "told" is made
 * idempotent.
 *
 * Why this exists at all: `lib/email.ts` no-ops unless `SMTP_HOST` is set, and
 * it is not set on this deployment. So `cycle-notify.ts` computed a correct
 * recipient map every morning and threw it away. §5.6's record was written and
 * §5.5's escalation reached nobody — least of all the skip-level manager, whom
 * §5.5 names as the one "with authority to compel action" and who has no §4.4
 * task row to discover it through. This makes the app itself the channel that
 * cannot be switched off; email is the second one, over the same map.
 *
 * Everything above `persistNotifications` is pure, and deliberately so: which
 * key an event gets, and which of the four rungs collapses to which
 * `NotificationKind`, are exactly the decisions that a test can check and a
 * screenshot cannot.
 */

/**
 * The four ladder rungs, collapsed to what they MEAN to a recipient.
 *
 * §5.6 needs four kinds because §11.2's report distinguishes them. A person
 * reading a popover does not: "you are being chased" and "this went past you"
 * are the two states that change what they do next, and `ESCALATED_HR` never
 * reaches this map because it is rolled into HR's digest instead.
 */
export function notificationKindFor(kind: ComplianceKind): NotificationKind {
  return kind === "REMINDER_SENT" ? "CYCLE_REMINDER" : "CYCLE_ESCALATION";
}

/**
 * A notification's identity, and the reason a daily sweep does not produce a
 * daily copy.
 *
 * This is `ComplianceEvent`'s own unique tuple —
 * `(cycleId, stageKind, subjectEmployeeId, kind, measuredAgainstDeadline)` —
 * with the recipient appended, because one event legitimately fans out to
 * several people and each of them is told once. Two consequences, both wanted:
 *
 *   - Re-running the sweep against an unresolved miss writes nothing. The
 *     unique index refuses it; there is no bookkeeping to get wrong.
 *   - HR extending the deadline (§5.5's own remedy) yields a NEW key, so the
 *     second miss is a second notification. The same reasoning put
 *     `measuredAgainstDeadline` in the compliance event's key — see the note on
 *     that column in schema.prisma.
 */
export function ladderDedupeKey(params: {
  cycleId: string;
  stageKind: string;
  subjectEmployeeId: string;
  kind: ComplianceKind;
  deadlineISO: string;
  recipientEmployeeId: string;
}): string {
  return [
    "cev",
    params.cycleId,
    params.stageKind,
    params.subjectEmployeeId,
    params.kind,
    params.deadlineISO,
    params.recipientEmployeeId,
  ].join(":");
}

/**
 * §9.7's reminders run on every sweep inside the window — that is the spec's
 * "automated reminders", and by email it is right. In a feed it would be one
 * identical row per day until the rater answers, which is how a feed becomes
 * something people stop reading. Keyed on the assignment and its deadline, a
 * rater is told once per deadline; an HR-moved 360 deadline tells them again.
 */
export function threeSixtyDedupeKey(assignmentId: string, deadlineISO: string): string {
  return `t360:${assignmentId}:${deadlineISO}`;
}

/** The HR digest changes daily by construction (counts move), so it is keyed by DAY. */
export function hrDigestDedupeKey(dayISO: string, recipientEmployeeId: string): string {
  return `hr:${dayISO}:${recipientEmployeeId}`;
}

/**
 * §6.2 — one notification per request per step **per recipient**, forever.
 *
 * The request id makes it unique and the step keeps the two moments apart: the
 * employee is told once that a change awaits them, and HR is told once that it
 * was acknowledged. Re-sending either would turn a workflow into nagging.
 *
 * The RECIPIENT is in the key because `dedupeKey` is globally unique
 * (`prisma/schema.prisma`), not unique per person. The "acknowledged" step fans
 * out to every HR user; without the recipient the first row inserted and every
 * other HR user's row collided on P2002 and was counted as a duplicate — so
 * exactly one arbitrarily-chosen HR user heard that a request was ready to
 * decide, silently, with the `catch` around the call reporting nothing. This is
 * how `hrDigestDedupeKey` above has always built its key; this one was the
 * outlier. Caught by the post-push breadth review.
 */
export function changeRequestDedupeKey(
  requestId: string,
  step: "raised" | "acknowledged",
  recipientEmployeeId: string,
): string {
  return `change-request:${requestId}:${step}:${recipientEmployeeId}`;
}
