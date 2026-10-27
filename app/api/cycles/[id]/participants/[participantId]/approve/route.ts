import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { contextBlockedReason, hrApprovalDecision, loadSignOffContext } from "@/lib/pms/signoff";

/**
 * HR approval — spec §5.1's LOCK.
 *
 * "HR reviews and approves. HR approval locks the KPIs as the agreed baseline."
 * The lock is the `goalsApprovedAt` / `goalsApprovedById` pair on
 * `CycleParticipant` and nothing else: there is no boolean beside it that could
 * drift, and `kpiEditBlockedReason` (lib/pms/kpi.ts) reads the same pair, so an
 * edit after approval is refused by the same fact that granted the approval.
 *
 * Two things this route deliberately does not have:
 *
 *   - **No unapprove.** §5.1 makes approval the baseline; §6.2 makes the
 *     correction path an audited mid-year change request (Phase 3). A DELETE
 *     here would be an unaudited way to reopen a locked year.
 *   - **No force flag.** The one case where HR may approve over a missing
 *     signature is §5.4's own resolution (the employee let the deadline pass),
 *     and `hrApprovalDecision` grants it by reading the stage state rather than
 *     by trusting a query parameter.
 */

export const POST = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id: cycleId, participantId } = await params;

    const actor = await resolveActor(session);
    // §4.1 — HR Super Admin and HRBP both "run the cycle org-wide (approvals
    // ...)". A line manager signs; only HR locks.
    if (!canRunCycle(actor)) return forbidden("Only HR may approve a KPI set.");
    if (!actor.employeeId) {
      return forbidden("This account has no linked employee record to record as approver.");
    }

    const ctx = await loadSignOffContext(participantId);
    if (!ctx) return notFound("Participant");
    // The participant id is unique on its own; the cycle id in the path must
    // still agree with it, or a mistyped URL would approve a different year's
    // set and report success against the year the caller thought they meant.
    if (ctx.participant.cycleId !== cycleId) return notFound("Participant");

    const contextBlocked = contextBlockedReason(ctx);
    if (contextBlocked) return err(contextBlocked, 409);
    const stage = ctx.stage;
    if (!stage) return err("This cycle has no goal-setting stage configured.", 409);

    // Idempotent: approving an approved set reports the existing lock rather
    // than moving `goalsApprovedAt` forward, which would rewrite when the
    // baseline was actually agreed.
    if (ctx.participant.goalsApprovedAt) {
      return ok({
        participantId,
        cycleId,
        goalsApprovedAt: ctx.participant.goalsApprovedAt,
        state: ctx.state,
        alreadyApproved: true,
      });
    }

    const decision = hrApprovalDecision({
      state: ctx.state,
      stage,
      now: new Date(),
      kpis: ctx.kpis,
    });
    if (!decision.allowed) return err(decision.reason, 409);

    const updated = await prisma.cycleParticipant.update({
      where: { id: participantId },
      data: { goalsApprovedAt: new Date(), goalsApprovedById: actor.employeeId },
      select: { id: true, cycleId: true, goalsApprovedAt: true, goalsApprovedById: true },
    });

    return ok({
      participantId: updated.id,
      cycleId: updated.cycleId,
      goalsApprovedAt: updated.goalsApprovedAt,
      goalsApprovedById: updated.goalsApprovedById,
      state: ctx.state,
      // The caller is told WHICH of §5.1's two routes to a lock was taken. An
      // approval over an absent employee signature (§5.4) is a materially
      // different record from a mutual agreement, and a screen that shows them
      // identically is a screen that hides the thing HR most needs to see.
      basis: decision.basis,
      note: decision.note,
      alreadyApproved: false,
    });
  }),
  { id: "pms-goals-approve", limit: 60, windowMs: 60_000 },
);
