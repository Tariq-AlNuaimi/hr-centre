import type { ComplianceKind, NotificationKind } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

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

/** Newest-first page size for the feed. A bell popover, not an inbox. */
export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * How much of one line survives into `body`.
 *
 * The ladder's `detail` strings are one sentence by construction, and the HR
 * digest is a handful of lines — but `detail` is free text on a database column,
 * and a feed row is a fixed-width popover. Truncating here rather than in CSS
 * keeps the stored row the size it renders at.
 */
export const MAX_BODY_CHARS = 500;

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

export type PendingNotification = {
  recipientEmployeeId: string;
  kind: NotificationKind;
  /** The machine's sentence. The heading comes from `kind`, translated client-side. */
  body: string;
  /** Locale-LESS path; the client prefixes its own locale. Null when nothing opens. */
  href: string | null;
  dedupeKey: string;
  /** JML S2 — the case it is about (JML kinds only). */
  caseId?: string | null;
  /** JML S2 — hidden until this instant (the working window). */
  sendAfter?: Date | null;
};

/** Keys per existence query. Postgres copes with far more; this keeps the plan flat. */
const EXISTS_CHUNK = 500;

/** Which of these have already been told? One indexed query per chunk, no writes. */
async function alreadySent(pending: readonly PendingNotification[]): Promise<Set<string>> {
  const sent = new Set<string>();
  for (let i = 0; i < pending.length; i += EXISTS_CHUNK) {
    const keys = pending.slice(i, i + EXISTS_CHUNK).map((p) => p.dedupeKey);
    const rows = await prisma.notification.findMany({
      take: EXISTS_CHUNK,
      where: { dedupeKey: { in: keys } },
      select: { dedupeKey: true },
    });
    for (const row of rows) sent.add(row.dedupeKey);
  }
  return sent;
}

/**
 * Write the ones nobody has been told yet; let the unique index catch the rest.
 *
 * ASK FIRST, THEN WRITE — and ask about ALL of them before writing ANY. The
 * cheap version of this looped `create` over every candidate and swallowed the
 * P2002s, which costs one round trip per already-told notification every single
 * morning: the daily sweep re-derives the same unresolved misses, so in steady
 * state almost every write is a collision. Worse, the row cap then applied to
 * the *candidates* rather than to the *writes*, so once the first `max` of them
 * existed, a sweep could never reach the ones behind them — it would spend its
 * whole budget colliding and make no progress, forever.
 *
 * Filtering first inverts both: a quiet morning costs a handful of indexed
 * reads and zero writes, and the budget is spent only on notifications nobody
 * has received. That is what makes a run interrupted by the cron's 60s ceiling
 * self-healing rather than permanently lossy — see the note on the `isNew` gate
 * in cycle-notify.ts.
 *
 * Per-row `create` rather than `createMany` for the reason ADR-010 gives:
 * `createMany` writes no audit row (`no-unaudited-bulk-write`), and a per-row
 * create is what lets one late duplicate — another sweep racing this one — be
 * swallowed without discarding its siblings. It is the same shape as the
 * sweep's own `writeEvents`, on purpose.
 *
 * Never throws. A notification that could not be written must not cost the
 * sweep a compliance row that was already committed.
 */
export async function persistNotifications(
  pending: readonly PendingNotification[],
  max: number,
): Promise<{ written: number; duplicates: number; failed: number; pending: number }> {
  let written = 0;
  let duplicates = 0;
  let failed = 0;

  const sent = await alreadySent(pending);
  const unsent = pending.filter((p) => !sent.has(p.dedupeKey));
  // Anything past the budget is not lost — it has no row, so the next run's
  // `alreadySent` will still report it missing and it moves to the front of the
  // queue. The count is reported so a backlog that never drains is visible.
  const batch = unsent.slice(0, max);

  for (const item of batch) {
    try {
      await prisma.notification.create({
        data: {
          recipientEmployeeId: item.recipientEmployeeId,
          kind: item.kind,
          body: item.body.slice(0, MAX_BODY_CHARS),
          href: item.href,
          dedupeKey: item.dedupeKey,
          caseId: item.caseId ?? null,
          sendAfter: item.sendAfter ?? null,
        },
        select: { id: true },
      });
      written += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Written between `alreadySent` and here — a concurrent sweep. Exactly
        // what idempotence looks like.
        duplicates += 1;
        continue;
      }
      // A foreign key that no longer resolves (the employee was hard-deleted
      // between the sweep's read and this write) must not abort the rest of the
      // fan-out. Counted rather than swallowed silently: the sweep reports it,
      // so a fan-out that is quietly failing is visible in the run's response
      // instead of looking like a quiet morning.
      failed += 1;
    }
  }

  return { written, duplicates, failed, pending: unsent.length - batch.length };
}
