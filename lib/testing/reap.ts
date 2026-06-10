// Vibe Inspector — read-time stale-run reaper (ADR-016).
//
// A background run killed by the serverless time limit (or by the process being
// recycled) can be left non-terminal (PENDING/RUNNING) with no one to finish it.
// There is no cron on the prototype rail, so we sweep on read: any run still
// non-terminal past the cutoff is marked FAILED. The cutoff is comfortably longer
// than the max function duration (300s on Pro) so a legitimately long run isn't
// killed early.

import { prisma } from "@/lib/prisma";

const STALE_MS = 7 * 60 * 1000; // 7 minutes

export async function reapStaleRuns(assessmentId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.testRun
    .updateMany({
      where: {
        ...(assessmentId ? { assessmentId } : {}),
        status: { in: ["PENDING", "RUNNING"] },
        createdAt: { lt: cutoff },
      },
      data: {
        status: "FAILED",
        error: "Run timed out (exceeded the function time limit). Re-run, or select fewer dimensions.",
        finishedAt: new Date(),
      },
    })
    .catch(() => {}); // never let cleanup break the read
}
