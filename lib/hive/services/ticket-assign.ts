import { prisma } from "@/lib/prisma";
import { canOnPair } from "./permissions";
import { pairHolders } from "./ticket-notify";

/**
 * Ticket ownership (UX review tickets P1-2): one person in the pair answers a
 * ticket. Assigning is a drafting act — the assigner and the assignee must
 * both be able to draft for the ticket's pair. Internal; the employee never
 * sees who it is.
 */
export async function assignEscalation(
  id: string,
  actorUserId: string,
  assigneeId: string | null,
): Promise<{ ok: true } | { error: "not_found" | "forbidden" | "invalid_assignee" }> {
  const row = await prisma.escalation.findUnique({
    where: { id },
    select: { id: true, hrPairId: true },
  });
  if (!row) return { error: "not_found" };
  if (!(await canOnPair(actorUserId, "draftEscalation", row.hrPairId)))
    return { error: "forbidden" };
  if (assigneeId && !(await canOnPair(assigneeId, "draftEscalation", row.hrPairId))) {
    return { error: "invalid_assignee" };
  }
  await prisma.escalation.update({ where: { id }, data: { assigneeId }, select: { id: true } });
  return { ok: true };
}

/**
 * Who may draft and who may approve on a pair, by name — the detail page's
 * "who answers / who approves" (P1-3) and the assignee picker. Bounded by the
 * holder queries (≤ 50 each).
 */
export async function pairPeople(pairId: string) {
  const [drafters, approvers] = await Promise.all([
    pairHolders("tickets.draft", pairId, { withGroup: true }),
    pairHolders("tickets.approve", pairId, { withGroup: true }),
  ]);
  const ids = [...new Set([...drafters, ...approvers])];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true, email: true },
        take: 100,
      })
    : [];
  const named = (set: Set<string>) =>
    users
      .filter((u) => set.has(u.id))
      .map((u) => ({ id: u.id, name: u.name ?? u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return { drafters: named(drafters), approvers: named(approvers) };
}
