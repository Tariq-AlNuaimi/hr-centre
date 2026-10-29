import type { NotificationKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { persistNotifications } from "@/lib/core/notify/store";

/**
 * In-app notices addressed to a LOGIN (docs/blueprints/ux-p0.md, US-6) — the
 * Hiring and HR ticket hand-offs, whose people are users and often have no
 * employee record. Written on the shared `Notification` table through the one
 * writer (`persistNotifications`: dedupe, audited per-row create).
 *
 * Rules every caller relies on:
 *   - NEVER THROWS. The business action it follows has already committed; a
 *     notice that could not be written must not turn that into a 500.
 *   - BOUNDED: at most MAX_RECIPIENTS people per notice.
 *   - NO RESTRICTED DATA: callers pass a sentence built from names, titles,
 *     roles and dates — never pay, ID numbers or full ticket text (a ticket
 *     question goes through `shortPreview`). A contract test pins the callers.
 */

const MAX_RECIPIENTS = 50;
export const PREVIEW_CHARS = 80;

export type UserNotice = {
  kind: NotificationKind;
  module: "hiring" | "tickets" | "jml";
  /** One plain sentence. */
  body: string;
  /** Locale-less path the bell opens. */
  href: string | null;
  /** The event's own identity; the recipient is appended (idempotency). */
  key: string;
};

export async function notifyUsers(
  userIds: Iterable<string | null | undefined>,
  notice: UserNotice,
  exclude: ReadonlyArray<string | null | undefined> = [],
): Promise<number> {
  try {
    const out = new Set(exclude.filter((x): x is string => Boolean(x)));
    const ids = [...new Set([...userIds].filter((x): x is string => Boolean(x)))]
      .filter((id) => !out.has(id))
      .slice(0, MAX_RECIPIENTS);
    if (ids.length === 0) return 0;
    const result = await persistNotifications(
      ids.map((id) => ({
        recipientUserId: id,
        module: notice.module,
        kind: notice.kind,
        body: notice.body,
        href: notice.href,
        dedupeKey: `${notice.key}:${id}`,
      })),
      MAX_RECIPIENTS,
    );
    return result.written;
  } catch {
    // Not detailed: the error could carry names. The action already committed.
    console.warn(`[notify] a ${notice.kind} notice could not be written`);
    return 0;
  }
}

/**
 * QA D-14 — an actionable notice stops reading "New" once the thing it asked for
 * is done. Marks unread notices whose event key starts with `keyPrefix` as read
 * — for `userIds` only, or for every recipient when omitted (the step was
 * decided, so nobody is still waiting on it). Per row through the audited
 * client, bounded. NEVER THROWS, like `notifyUsers`: the action has committed.
 */
export async function resolveUserNotices(
  keyPrefix: string,
  userIds?: ReadonlyArray<string | null | undefined>,
): Promise<number> {
  try {
    const ids = userIds?.filter((x): x is string => Boolean(x));
    if (ids && ids.length === 0) return 0;
    const rows = await prisma.notification.findMany({
      where: {
        dedupeKey: { startsWith: keyPrefix },
        readAt: null,
        recipientUserId: ids ? { in: ids } : { not: null },
      },
      select: { id: true },
      take: MAX_RECIPIENTS,
    });
    const now = new Date();
    for (const r of rows) {
      await prisma.notification.update({
        where: { id: r.id },
        data: { readAt: now },
        select: { id: true },
      });
    }
    return rows.length;
  } catch {
    console.warn("[notify] notices could not be marked done");
    return 0;
  }
}

/** A ticket question as a notice may show it: one line, at most PREVIEW_CHARS. */
export function shortPreview(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
