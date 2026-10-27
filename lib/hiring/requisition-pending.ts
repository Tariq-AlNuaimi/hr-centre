import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeChain } from "./approval-chain";
import { approvalRoleLabel, configToChainOptions, loadApprovalConfig } from "./approval-config";
import { toOMRorNull } from "./money";
import { nextUnsignedStep } from "./requisition-rules";

/**
 * Where a pending requisition is stuck (UX review P1-12): the next unsigned
 * step of its CURRENT round, by role, and how long the round has waited on it
 * (since submission or the last signature). The chain is computed the way the
 * approval screen computes it — today's config, the band max in OMR — but
 * without resolving holders, which is the expensive part and not needed for a
 * label. Three batched reads for the whole page, never one per row.
 */

type PendingRow = {
  id: string;
  status: string;
  entityId: string;
  salaryBandMax: Prisma.Decimal | number | null;
  salaryCurrency: string;
};

export type PendingStep = { role: string; days: number };

const DAY_MS = 86_400_000;
/** Resubmissions per requisition are rare; this bounds the latest-round read. */
const ROUNDS_PER_REQ = 10;
const MAX_CHAIN = 20;

/** The latest submission per requisition from rows ordered newest first. */
function latestRounds(rows: { id: string; requisitionId: string; changedAt: Date }[]) {
  const out = new Map<string, { id: string; changedAt: Date }>();
  for (const r of rows) if (!out.has(r.requisitionId)) out.set(r.requisitionId, r);
  return out;
}

export async function pendingSteps(
  rows: readonly PendingRow[],
  now: Date = new Date(),
): Promise<Map<string, PendingStep>> {
  const pending = rows.filter((r) => r.status === "PENDING_APPROVAL");
  if (pending.length === 0) return new Map();
  const ids = pending.map((r) => r.id);
  const entityIds = [...new Set(pending.map((r) => r.entityId))];
  const [cfg, entities, history] = await Promise.all([
    loadApprovalConfig(),
    prisma.orgEntity.findMany({
      where: { id: { in: entityIds } },
      select: { id: true, code: true },
      take: entityIds.length,
    }),
    prisma.hiringRequisitionStatusHistory.findMany({
      where: { requisitionId: { in: ids }, toStatus: "PENDING_APPROVAL" },
      orderBy: { changedAt: "desc" },
      select: { id: true, requisitionId: true, changedAt: true },
      take: ids.length * ROUNDS_PER_REQ,
    }),
  ]);
  const rounds = latestRounds(history);
  const submissionIds = [...rounds.values()].map((r) => r.id);
  const signed = submissionIds.length
    ? await prisma.hiringRequisitionApproval.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { submissionId: true, sequence: true, requiredRole: true, createdAt: true },
        take: submissionIds.length * MAX_CHAIN,
      })
    : [];
  const codes = new Map(entities.map((e) => [e.id, e.code]));
  const opts = { ...configToChainOptions(cfg), kind: "requisition" as const };
  const out = new Map<string, PendingStep>();
  for (const r of pending) {
    const round = rounds.get(r.id);
    if (!round) continue;
    const mine = signed.filter((s) => s.submissionId === round.id);
    const chain = computeChain(
      codes.get(r.entityId),
      toOMRorNull(r.salaryBandMax, r.salaryCurrency),
      opts,
    );
    const next = nextUnsignedStep(chain, mine);
    if (!next) continue;
    const since = Math.max(round.changedAt.getTime(), ...mine.map((s) => s.createdAt.getTime()));
    out.set(r.id, {
      role: approvalRoleLabel(next.role),
      days: Math.max(0, Math.floor((now.getTime() - since) / DAY_MS)),
    });
  }
  return out;
}
