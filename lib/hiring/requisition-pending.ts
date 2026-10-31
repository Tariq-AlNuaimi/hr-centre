import type { HiringApprovalRole } from "@/generated/prisma/client";
import { currentStep } from "@/lib/core/approvals/rules";
import { latestRounds } from "@/lib/core/approvals/store";
import { approvalRoleLabel } from "./approval-config";
import { REQUISITION_SUBJECT } from "./offer-round";

/**
 * Where a pending requisition is stuck (UX review P1-12): the current step of
 * its open approval round (core engine, ADR-094), by role, and how long the
 * round has waited on it (since submission or the last signature). One
 * batched read for the whole page, never one per row.
 */

type PendingRow = { id: string; status: string };

export type PendingStep = { role: string; days: number };

const DAY_MS = 86_400_000;

export async function pendingSteps(
  rows: readonly PendingRow[],
  now: Date = new Date(),
): Promise<Map<string, PendingStep>> {
  const pending = rows.filter((r) => r.status === "PENDING_APPROVAL");
  if (pending.length === 0) return new Map();
  const rounds = await latestRounds(
    REQUISITION_SUBJECT,
    pending.map((r) => r.id),
  );
  const out = new Map<string, PendingStep>();
  for (const r of pending) {
    const round = rounds.get(r.id);
    const step = round?.status === "PENDING" ? currentStep(round.steps) : undefined;
    if (!round || !step) continue;
    const since = Math.max(
      round.createdAt.getTime(),
      ...round.decisions.map((d) => d.decidedAt.getTime()),
    );
    out.set(r.id, {
      role: approvalRoleLabel(step.roleKey as HiringApprovalRole),
      days: Math.max(0, Math.floor((now.getTime() - since) / DAY_MS)),
    });
  }
  return out;
}
