import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { pairsFor } from "./permissions";

/**
 * HR tickets on HR Centre's home "My tasks" (US-H10): what is waiting on THIS
 * person, by assignment, not role name —
 *   - to approve: submitted answers (and failed sends to retry) in pairs they
 *     may approve, never their own draft (the self-approval ban);
 *   - to answer: open or reopened tickets in pairs they may draft for.
 * Bounded: counts plus the five oldest of each (oldest first — they have
 * waited longest).
 *
 * @public
 */

const ROW = {
  id: true,
  ticketNumber: true,
  status: true,
  question: true,
  createdAt: true,
  hrPair: { select: { name: true } },
} as const;

function inPairs(pairs: "all" | string[]): Prisma.EscalationWhereInput | null {
  if (pairs === "all") return {};
  return pairs.length > 0 ? { hrPairId: { in: pairs } } : null;
}

export async function ticketTasksFor(userId: string) {
  const [approvePairs, draftPairs] = await Promise.all([
    pairsFor(userId, "approve"),
    pairsFor(userId, "draftEscalation"),
  ]);
  const approveScope = inPairs(approvePairs);
  const draftScope = inPairs(draftPairs);

  const toApprove: Prisma.EscalationWhereInput | null = approveScope && {
    ...approveScope,
    OR: [
      { status: "PENDING_APPROVAL", NOT: { draftedById: userId } },
      { status: "PENDING_APPROVAL", draftedById: null },
      { status: "SEND_FAILED" },
    ],
  };
  const toAnswer: Prisma.EscalationWhereInput | null = draftScope && {
    ...draftScope,
    status: { in: ["OPEN", "IN_PROGRESS"] },
  };

  const list = (where: Prisma.EscalationWhereInput | null) =>
    where
      ? Promise.all([
          prisma.escalation.count({ where }),
          prisma.escalation.findMany({
            where,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: ROW,
            take: 5,
          }),
        ])
      : Promise.resolve([0, []] as const);

  const [[approveCount, approveRows], [answerCount, answerRows]] = await Promise.all([
    list(toApprove),
    list(toAnswer),
  ]);
  return {
    canApprove: approveScope !== null,
    canDraft: draftScope !== null,
    toApprove: { count: approveCount, rows: approveRows },
    toAnswer: { count: answerCount, rows: answerRows },
  };
}

/**
 * One employee's tickets, for the "HR tickets" tab on their record. The caller
 * has checked `tickets.see` (company-wide by design, HIVE AC-10.1). Bounded.
 */
export async function ticketsForEmployee(employeeId: string) {
  return prisma.escalation.findMany({
    where: { employeeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { ...ROW, identityVerified: true, sentAt: true },
    take: 50,
  });
}
