import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { stageHistoryFor } from "./candidate-stage";
import { candidateScopeWhere } from "./scope";
import { furthestStageReached, noticeState, noticeTemplateFor } from "./notice-rules";
import { initialsOf } from "./scorecard-math";

/**
 * The close-out queue (step 13) — Interview Hub `/api/candidates/close-out`.
 * Rejected candidates and their notice: sent, held (another finalist's offer
 * is still open) or ready. Nothing is emailed from here — HR sends the notice
 * from their own mailbox and marks it sent.
 */

export async function listCloseOut(
  actor: HiringActor,
  q: { page: number; pageSize: number; requisitionId?: string },
) {
  const scope = await candidateScopeWhere(actor, "hiring.manage");
  if (scope === null) return { data: [], total: 0, counts: { ready: 0, held: 0, sent: 0 } };
  const where: Prisma.HiringCandidateWhereInput = {
    AND: [
      scope,
      { stage: "REJECTED", erasedAt: null },
      q.requisitionId ? { requisitionId: q.requisitionId } : {},
    ],
  };
  const now = new Date();
  const [rows, total, sent, held] = await Promise.all([
    prisma.hiringCandidate.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        name: true,
        stage: true,
        rejectionReason: true,
        rejectionNoticeSentAt: true,
        rejectionHoldUntil: true,
        requisition: { select: { id: true, title: true } },
      },
    }),
    prisma.hiringCandidate.count({ where }),
    prisma.hiringCandidate.count({
      where: { AND: [where, { rejectionNoticeSentAt: { not: null } }] },
    }),
    prisma.hiringCandidate.count({
      where: { AND: [where, { rejectionNoticeSentAt: null, rejectionHoldUntil: { gt: now } }] },
    }),
  ]);
  const history = await stageHistoryFor(rows.map((r) => r.id));
  return {
    total,
    counts: { sent, held, ready: total - sent - held },
    data: rows.map((r) => {
      const reached = furthestStageReached(r.stage, history.get(r.id) ?? []);
      const state = noticeState({
        noticeSentAt: r.rejectionNoticeSentAt,
        holdUntil: r.rejectionHoldUntil,
        now,
      });
      return {
        id: r.id,
        name: r.name,
        initials: initialsOf(r.name),
        requisition: r.requisition,
        reached,
        reason: r.rejectionReason,
        noticeStatus: state.status,
        noticeSentAt: r.rejectionNoticeSentAt,
        holdUntil: state.holdUntil,
        template: noticeTemplateFor(reached),
      };
    }),
  };
}

/** Mark notices sent (HR sent them by hand). Only rejected candidates in scope; one by one, audited. */
export async function markNoticesSent(actor: HiringActor, ids: readonly string[]) {
  const scope = await candidateScopeWhere(actor, "hiring.manage");
  if (scope === null) return { marked: 0, skipped: ids.length };
  const rows = await prisma.hiringCandidate.findMany({
    where: {
      AND: [scope, { id: { in: [...ids] }, stage: "REJECTED", rejectionNoticeSentAt: null }],
    },
    select: { id: true },
    take: ids.length,
  });
  const at = new Date();
  for (const r of rows) {
    await prisma.hiringCandidate.update({
      where: { id: r.id },
      data: { rejectionNoticeSentAt: at, rejectionHoldUntil: null },
      select: { id: true },
    });
  }
  return { marked: rows.length, skipped: ids.length - rows.length };
}
