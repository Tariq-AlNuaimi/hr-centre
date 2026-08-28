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

export type PendingNotification = {
  recipientEmployeeId: string;
  kind: NotificationKind;
  /** The machine's sentence. The heading comes from `kind`, translated client-side. */
  body: string;
  /** Locale-LESS path; the client prefixes its own locale. Null when nothing opens. */
  href: string | null;
  dedupeKey: string;
};

/**
 * Write the ones that are new; let the unique index discard the rest.
 *
 * Per-row `create` rather than `createMany` for the reason ADR-010 gives:
 * `createMany` writes no audit row (`no-unaudited-bulk-write`), and a per-row
 * create is what lets one duplicate be swallowed without discarding its
 * siblings. It is the same shape as the sweep's own `writeEvents`, on purpose —
 * a reader who has understood one has understood both.
 *
 * Never throws. A notification that could not be written must not cost the
 * sweep a compliance row that was already committed, which is why the caller
 * runs this AFTER the rows and why the loop swallows per-row failures.
 */
export async function persistNotifications(
  pending: readonly PendingNotification[],
): Promise<{ written: number; duplicates: number; failed: number }> {
  let written = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await prisma.notification.create({
        data: {
          recipientEmployeeId: item.recipientEmployeeId,
          kind: item.kind,
          body: item.body.slice(0, MAX_BODY_CHARS),
          href: item.href,
          dedupeKey: item.dedupeKey,
        },
        select: { id: true },
      });
      written += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Already told. Exactly what idempotence looks like.
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

  return { written, duplicates, failed };
}
