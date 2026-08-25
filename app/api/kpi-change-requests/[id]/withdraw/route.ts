import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { withdrawBlockedReason } from "@/lib/pms/change-request";
import { CHANGE_REQUEST_SELECT, serializeChangeRequest } from "@/lib/pms/change-request-select";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";

/**
 * The requester takes a pending change request back — §6.2.
 *
 * **A withdrawal is a STATUS, never a DELETE.** §6.3 wants the history of what
 * was asked, not only of what was approved: a manager who proposes halving an
 * employee's sales target and thinks better of it has still proposed it, and a
 * row that vanishes takes the only evidence of the conversation with it. The
 * partial unique index is `WHERE status = 'PENDING'`, so withdrawing also frees
 * the participant to receive a corrected request immediately.
 *
 * POST rather than DELETE for exactly that reason — the verb should not suggest
 * the row goes away.
 *
 * No stage-window check. §5.4 locks the party who owns an ACTION out of taking
 * it; withdrawing removes a request rather than changing a baseline, and a
 * manager who realises after the deadline that their proposal was wrong should
 * be able to take it back rather than leave HR to reject it.
 */

export const POST = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const existing = await prisma.kpiChangeRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        requestedByEmployeeId: true,
        participant: { select: { employeeId: true } },
      },
    });
    if (!existing) return notFound("Change request");

    // §4.2 — visibility first, so a request id cannot be probed from outside the
    // actor's chain.
    const descendants = actor.capabilities.orgWide
      ? new Set<string>()
      : actor.employeeId
        ? await descendantEmployeeIds(actor.employeeId)
        : new Set<string>();
    if (!canViewEmployee(actor, existing.participant.employeeId, descendants)) {
      return notFound("Change request");
    }

    const blocked = withdrawBlockedReason({
      actor,
      requestedByEmployeeId: existing.requestedByEmployeeId,
      status: existing.status,
    });
    if (blocked) {
      return blocked.status === 404 ? notFound("Change request") : err(blocked.reason, 409);
    }

    // Conditional UPDATE, same arbiter as the decide route: HR pressing Approve
    // while the manager presses Withdraw must not produce a withdrawn request
    // whose edits were applied.
    // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
    const claimed = await prisma.kpiChangeRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    if (claimed.count === 0) {
      return err(
        "This request was decided by HR a moment ago and can no longer be withdrawn.",
        409,
      );
    }
    // §6.3 keeps the row; the trail keeps WHO took it back and when.
    await recordAudit(prisma, {
      entityType: "KpiChangeRequest",
      entityId: id,
      action: "UPDATE",
      before: { status: "PENDING" },
      after: { status: "WITHDRAWN", withdrawnByEmployeeId: actor.employeeId },
    });

    const row = await prisma.kpiChangeRequest.findUniqueOrThrow({
      where: { id },
      select: CHANGE_REQUEST_SELECT,
    });
    return ok({ changeRequest: serializeChangeRequest(row) });
  }),
  { id: "pms-change-request-write", limit: 30, windowMs: 60_000 },
);
