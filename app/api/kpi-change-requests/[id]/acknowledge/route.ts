import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { MID_YEAR_STAGE, acknowledgeBlockedReason } from "@/lib/pms/change-request";
import { CHANGE_REQUEST_SELECT, serializeChangeRequest } from "@/lib/pms/change-request-select";
import { changeRequestDedupeKey, persistNotifications } from "@/lib/pms/notifications";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";

/**
 * The employee acknowledges a mid-year change to their own KPIs — §6.2.
 *
 * **There is no reject button, and that is the design.** §5.1's goal-setting
 * sign-off has the same shape: the disagreement is settled in the offline
 * conversation, and the system records only whether the employee said "I have
 * seen this". Under the flow this route completes, silence is not neutral —
 * a request the employee never acknowledges locks at the mid-year deadline and
 * the KPI stays as it was (`NOT_ACKNOWLEDGED`). The absence of this click is
 * therefore the strongest thing an employee can say, which is why no reject
 * button is needed to give them a voice.
 *
 * POST, and idempotent only in the sense that a second attempt is refused with
 * 409 rather than silently re-stamping the time: §6.3's history wants the
 * instant the employee actually acknowledged, not the last time they opened the
 * page.
 *
 * Only the employee themselves. Not their manager, and not HR — HR's exception
 * is the override on the decide route, which is recorded AS an override. An HR
 * click that quietly became the employee's acknowledgment would erase exactly
 * the distinction the history exists to keep.
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
        acknowledgedAt: true,
        participant: {
          select: {
            employeeId: true,
            cycle: {
              select: {
                stages: {
                  where: { kind: MID_YEAR_STAGE },
                  select: { kind: true, opensAt: true, deadline: true, graceDays: true },
                },
              },
            },
          },
        },
      },
    });
    if (!existing) return notFound("Change request");

    // §4.2 — visibility first, so a request id cannot be probed from outside the
    // actor's chain. An employee always sees their own.
    const descendants = await visibilityDescendants(actor);
    if (!canViewEmployee(actor, existing.participant.employeeId, descendants)) {
      return notFound("Change request");
    }

    const stage = existing.participant.cycle.stages[0] ?? null;
    const blocked = acknowledgeBlockedReason({
      actor,
      subjectEmployeeId: existing.participant.employeeId,
      status: existing.status,
      acknowledgedAt: existing.acknowledgedAt,
      stage,
      now: new Date(),
    });
    if (blocked) return err(blocked.reason, blocked.status);

    // Conditional claim, same arbiter as the decide and withdraw routes: an
    // employee acknowledging while HR rejects must not produce an
    // acknowledgment attached to a request that is no longer pending. The
    // `acknowledged_at IS NULL` half makes a double-click one acknowledgment
    // rather than two timestamps, under concurrency and not merely in the form.
    const acknowledgedAt = new Date();
    const claimed = await auditedTransaction(async (tx) => {
      // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
      const result = await tx.kpiChangeRequest.updateMany({
        where: { id, status: "PENDING", acknowledgedAt: null },
        data: { acknowledgedAt, acknowledgedByEmployeeId: actor.employeeId },
      });
      if (result.count === 0) return false;
      await recordAudit(tx, {
        entityType: "KpiChangeRequest",
        entityId: id,
        action: "UPDATE",
        before: { acknowledgedAt: null, acknowledgedByEmployeeId: null },
        after: {
          acknowledgedAt: acknowledgedAt.toISOString(),
          acknowledgedByEmployeeId: actor.employeeId,
        },
      });
      return true;
    });
    if (!claimed) {
      return err(
        "This request changed a moment ago — reload it. Either HR decided it, or your " +
          "acknowledgment was already recorded.",
        409,
      );
    }

    // §6.2 — HR decides with the acknowledgment in front of them, so HR is told
    // it arrived. Best-effort and after the commit, for the reason the sweep
    // gives: a mail server having a bad morning must never cost a recorded act.
    try {
      const hrRecipients = await prisma.employee.findMany({
        where: { status: "ACTIVE", pmsRoles: { hasSome: ["HR_SUPER_ADMIN", "HRBP"] } },
        select: { id: true },
        take: 50,
      });
      await persistNotifications(
        hrRecipients.map((hr) => ({
          recipientEmployeeId: hr.id,
          kind: "CHANGE_REQUEST_ACKNOWLEDGED" as const,
          body: "An employee acknowledged a mid-year KPI change. It is ready for your decision.",
          href: `/mid-year`,
          dedupeKey: changeRequestDedupeKey(id, "acknowledged"),
        })),
        50,
      );
    } catch {
      // Deliberately swallowed: the acknowledgment is committed and is the
      // product; the notification is a courtesy.
    }

    const row = await prisma.kpiChangeRequest.findUniqueOrThrow({
      where: { id },
      select: CHANGE_REQUEST_SELECT,
    });
    return ok({ changeRequest: serializeChangeRequest(row) });
  }),
  { id: "pms-change-request-write", limit: 30, windowMs: 60_000 },
);
