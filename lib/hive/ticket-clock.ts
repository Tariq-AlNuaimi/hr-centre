import type { EscalationStatus, Prisma } from "@/generated/prisma/client";

/**
 * HR tickets' internal clock, pure (UX P1 tickets P1-2): which statuses still
 * need HR, the ageing badge, and the queue's saved views. No database access,
 * so the badge can render in the browser.
 */

/** Statuses where the ticket still needs HR. */
export const OPEN_STATUSES: readonly EscalationStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "APPROVED",
  "SEND_FAILED",
];

export type Ageing = "none" | "ok" | "soon" | "overdue";

/** The badge a queue row wears: overdue, due within 4 hours, or fine. Pure. */
export function ageing(
  dueAt: Date | string | null,
  status: EscalationStatus,
  now: Date = new Date(),
): Ageing {
  if (!dueAt || !OPEN_STATUSES.includes(status)) return "none";
  const left = new Date(dueAt).getTime() - now.getTime();
  if (left < 0) return "overdue";
  return left <= 4 * 3_600_000 ? "soon" : "ok";
}

export type QueueView = "mine" | "unassigned" | "overdue";

/** The queue's saved views as a `where` (P1-2). Pure. */
export function viewWhere(
  view: QueueView | undefined,
  userId: string,
  now: Date = new Date(),
): Prisma.EscalationWhereInput {
  const open = { status: { in: [...OPEN_STATUSES] } };
  if (view === "mine") return { ...open, assigneeId: userId };
  if (view === "unassigned") return { ...open, assigneeId: null };
  if (view === "overdue") return { ...open, dueAt: { lt: now } };
  return {};
}
