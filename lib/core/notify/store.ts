import type { NotificationKind } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { mutedInApp } from "./preferences";

/**
 * The core notification store (P2 platform, ADR-091): who a feed belongs to and
 * the one idempotent writer every module's emitter goes through. Module-specific
 * keys and kinds (the Performance ladder, JML, Hiring, tickets) stay with the
 * module; they register their kinds in `lib/core/notify/registry.ts`.
 */

/**
 * Whose feed this is: the viewer's employee record (Performance, JML) and their
 * login (Hiring, HR tickets — UX review P0, US-6). Built from the session only;
 * nothing in a request can widen it. An unlinked account still gets the
 * notifications addressed to its login.
 */
export function feedOwnerWhere(
  employeeId: string | null,
  userId: string,
): Prisma.NotificationWhereInput {
  return employeeId
    ? { OR: [{ recipientEmployeeId: employeeId }, { recipientUserId: userId }] }
    : { recipientUserId: userId };
}

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

export type PendingNotification = {
  /** Exactly one recipient: an Employee (Performance, JML) or a User (Hiring, HR tickets). */
  recipientEmployeeId?: string | null;
  recipientUserId?: string | null;
  /** The raising module, for the bell's chip ("hiring", "tickets", …). */
  module?: string | null;
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

/**
 * Drop the notices their recipient has turned off (ADR-095 preferences). A
 * mandatory kind is never dropped; an employee recipient is matched through
 * their login. Two bounded queries for the whole batch.
 */
async function withoutMuted(
  pending: readonly PendingNotification[],
): Promise<readonly PendingNotification[]> {
  const employeeIds = [
    ...new Set(pending.map((p) => p.recipientEmployeeId).filter((x): x is string => Boolean(x))),
  ];
  const logins = employeeIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: employeeIds }, userId: { not: null } },
        select: { id: true, userId: true },
        take: employeeIds.length,
      })
    : [];
  const loginOf = new Map(logins.map((e) => [e.id, e.userId!]));
  const userOf = (p: PendingNotification) =>
    p.recipientEmployeeId ? loginOf.get(p.recipientEmployeeId) : (p.recipientUserId ?? undefined);
  const users = [...new Set(pending.map(userOf).filter((x): x is string => Boolean(x)))];
  const off = await mutedInApp(users, [...new Set(pending.map((p) => p.kind))]);
  if (off.size === 0) return pending;
  return pending.filter((p) => {
    const u = userOf(p);
    return !u || !off.has(`${u}:${p.kind}`);
  });
}

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
  // Fail open: a preferences read that fails must not swallow a notice.
  const wanted = await withoutMuted(pending).catch(() => pending);
  const unsent = wanted.filter((p) => !sent.has(p.dedupeKey));
  // Anything past the budget is not lost — it has no row, so the next run's
  // `alreadySent` will still report it missing and it moves to the front of the
  // queue. The count is reported so a backlog that never drains is visible.
  const batch = unsent.slice(0, max);

  for (const item of batch) {
    try {
      await prisma.notification.create({
        data: {
          recipientEmployeeId: item.recipientEmployeeId ?? null,
          recipientUserId: item.recipientEmployeeId ? null : (item.recipientUserId ?? null),
          module: item.module ?? null,
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
