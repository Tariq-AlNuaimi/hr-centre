import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { eraseCandidate } from "./erasure";

/**
 * The daily hiring retention sweep (Interview Hub `/api/internal/retention`).
 * Candidates who ended REJECTED or WITHDRAWN, or were deleted, and have not
 * been touched for CANDIDATE_RETENTION_DAYS (default 365) are erased in full
 * (erasure.ts). A candidate linked to an employee is never swept. Bounded per
 * run; `more` says the next run continues.
 */

export const RETENTION_BATCH = 25;

export function retentionCutoff(now: Date, days = env.CANDIDATE_RETENTION_DAYS) {
  return new Date(now.getTime() - days * 86_400_000);
}

function dueWhere(cutoff: Date): Prisma.HiringCandidateWhereInput[] {
  return [
    {
      erasedAt: null,
      employeeId: null,
      stage: { in: ["REJECTED", "WITHDRAWN"] },
      updatedAt: { lte: cutoff },
    },
    { erasedAt: null, employeeId: null, deletedAt: { not: null, lte: cutoff } },
  ];
}

export async function runHiringRetention(now = new Date()) {
  const cutoff = retentionCutoff(now);
  const [live, deleted] = dueWhere(cutoff);
  const [a, b] = await Promise.all([
    prisma.hiringCandidate.findMany({
      where: live,
      orderBy: { updatedAt: "asc" },
      take: RETENTION_BATCH,
      select: { id: true },
    }),
    prisma.hiringCandidate.findMany({
      where: deleted,
      orderBy: { deletedAt: "asc" },
      take: RETENTION_BATCH,
      select: { id: true },
    }),
  ]);
  const due = [...new Set([...a, ...b].map((r) => r.id))].slice(0, RETENTION_BATCH);
  let erased = 0;
  let failed = 0;
  for (const id of due) {
    try {
      if (await eraseCandidate(id, "hiring-retention@system")) erased += 1;
    } catch {
      failed += 1;
      console.error("hiring retention: one candidate could not be erased");
    }
  }
  return {
    retentionDays: env.CANDIDATE_RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
    erased,
    failed,
    more: a.length + b.length > due.length || due.length === RETENTION_BATCH,
  };
}
