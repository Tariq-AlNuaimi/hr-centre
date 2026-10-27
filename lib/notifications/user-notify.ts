import type { NotificationKind } from "@/generated/prisma/client";
import { persistNotifications } from "@/lib/pms/notifications";

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

export const MAX_RECIPIENTS = 50;
export const PREVIEW_CHARS = 80;

export type UserNotice = {
  kind: NotificationKind;
  module: "hiring" | "tickets";
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

/** A ticket question as a notice may show it: one line, at most PREVIEW_CHARS. */
export function shortPreview(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
