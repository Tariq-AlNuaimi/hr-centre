import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { resolveActor } from "@/lib/pms/actor";
import {
  MID_YEAR_STAGE,
  applyEdit,
  changeRequestAccessRefusal,
  fieldChanges,
  proposedWeightageTotal,
  type KpiEdit,
} from "@/lib/pms/change-request";
import { CHANGE_REQUEST_SELECT, serializeChangeRequest } from "@/lib/pms/change-request-select";
import { changeRequestDedupeKey, persistNotifications } from "@/lib/pms/notifications";
import { descendantEmployeeIds, visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { createChangeRequestSchema } from "@/lib/validations/change-request";

/**
 * Mid-year KPI change requests — spec §6.
 *
 * POST raises one; GET lists the ones the caller may see. HR's decision and the
 * requester's withdrawal are separate routes, because they are separate
 * authorities (§6.2) and a single handler switching on a `status` field in the
 * body is how the two eventually share a check that only one of them should
 * pass.
 *
 * **A request carries SEVERAL edits and is decided as one unit.** §6.2 speaks of
 * changing "a KPI", singular, but §5.3 requires weightages to total exactly 100:
 * moving one necessarily breaks the set, and mid-year has no sign-off to catch
 * it. The rebalance therefore travels with the change. `lib/pms/change-request.ts`
 * carries the full reasoning; this route only enforces it.
 *
 * Nothing is applied here. A pending request changes no KPI — the live baseline
 * stays exactly as HR approved it until HR approves the change too (§5.1).
 */

/** The KPI columns a request is validated against — §5.2's seven editable ones. */
const KPI_STATE_SELECT = {
  id: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
} satisfies Prisma.KpiSelect;

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const input = parsed.data;

    const participant = await prisma.cycleParticipant.findUnique({
      where: { id: input.participantId },
      select: {
        id: true,
        goalsApprovedAt: true,
        // Enumerated columns — never `include: { employee: true }`, which would
        // carry `basicSalaryEnc` (Restricted, §4.5) into a workflow response.
        employee: { select: { id: true, managerId: true, roleTrack: true } },
        cycle: {
          select: {
            status: true,
            stages: {
              where: { kind: MID_YEAR_STAGE },
              select: { kind: true, opensAt: true, deadline: true, graceDays: true },
            },
          },
        },
        kpis: { where: { deletedAt: null }, select: KPI_STATE_SELECT, take: 200 },
      },
    });
    if (!participant) return notFound("Participant");

    const descendants = await visibilityDescendants(actor);

    // §4.2 → §8.3 → §2 → §5.1/§5.4, in one shared function so this route and the
    // manager's screen refuse in the same words.
    const refusal = changeRequestAccessRefusal({
      actor,
      visible: canViewEmployee(actor, participant.employee.id, descendants),
      employee: participant.employee,
      cycleStatus: participant.cycle.status,
      stage: participant.cycle.stages[0] ?? null,
      goalsApprovedAt: participant.goalsApprovedAt,
      now,
    });
    if (refusal) {
      return refusal.status === 404 ? notFound("Participant") : err(refusal.reason, refusal.status);
    }

    const requesterId = actor.employeeId;
    if (!requesterId) return err("This account has no linked employee record (ADR-065).", 403);

    // Every edit must name a KPI that is actually in the set. Silently dropping
    // an unknown id would approve something other than what was asked for.
    const live = new Map(participant.kpis.map((k) => [k.id, k]));
    const strangers = input.edits.filter((e) => !live.has(e.kpiId));
    if (strangers.length > 0) {
      return err(
        `This request names ${strangers.length} KPI(s) that are not in this participant's set. ` +
          `Reload the page — the set may have changed since you opened it.`,
        409,
      );
    }

    // An edit that proposes the value a field already holds is not a change.
    // §6.3's history is meant to answer "what moved"; a no-op row makes it
    // answer "someone pressed save", which is a different and useless question.
    // Checked against the LIVE value, so re-sending an unchanged descriptor
    // alongside a real edit is fine — only an entirely inert edit is refused.
    const inert = input.edits.filter((edit) => {
      const before = live.get(edit.kpiId)!;
      return Object.keys(fieldChanges(before, applyEdit(before, edit as KpiEdit))).length === 0;
    });
    if (inert.length > 0) {
      return err(
        `${inert.length} of the proposed edits change nothing — every value sent already matches ` +
          `the KPI. Remove them, or change something (§6.2).`,
        400,
      );
    }

    // §5.3, at submission as well as at approval. HR can still be shown the
    // arithmetic when they decide (the set may move underneath a pending
    // request), but a manager should learn at the point of writing that their
    // proposal does not add up, not days later through a rejection.
    const total = proposedWeightageTotal(participant.kpis, input.edits as KpiEdit[]);
    if (!total.equals(100)) {
      const gap = total.minus(100);
      return err(
        `These changes would leave weightages at ${total}% — ` +
          `${gap.abs()}% ${gap.isNegative() ? "short of" : "over"} the 100% §5.3 requires. ` +
          `Rebalance the whole set in this one request.`,
        409,
      );
    }

    try {
      const changeRequest = await prisma.kpiChangeRequest.create({
        data: {
          participantId: participant.id,
          requestedByEmployeeId: requesterId,
          rationale: input.rationale,
          edits: {
            create: input.edits.map((edit) => ({
              kpiId: edit.kpiId,
              description: edit.description ?? null,
              // The decimal STRING goes straight to Prisma, never through a JS
              // number: §5.3's comparison is exact and a double is not.
              weightage: edit.weightage === undefined ? null : new Prisma.Decimal(edit.weightage),
              descriptorOutstanding: edit.descriptorOutstanding ?? null,
              descriptorExcellent: edit.descriptorExcellent ?? null,
              descriptorTarget: edit.descriptorTarget ?? null,
              descriptorAlmostAchieved: edit.descriptorAlmostAchieved ?? null,
              descriptorUnsatisfactory: edit.descriptorUnsatisfactory ?? null,
            })),
          },
        },
        select: CHANGE_REQUEST_SELECT,
      });
      // §6.2 — the employee is the next actor now, not HR, so they are told.
      // After the commit and best-effort: the request is the product, the
      // notification is how the employee learns it is waiting. Swallowed on
      // failure for the reason the sweep gives — a mail server having a bad
      // morning must never cost a recorded act.
      try {
        await persistNotifications(
          [
            {
              recipientEmployeeId: participant.employee.id,
              kind: "CHANGE_REQUEST_RAISED" as const,
              body:
                "Your manager has proposed a mid-year change to your KPIs. Review it and " +
                "acknowledge it before the mid-year deadline.",
              href: `/mid-year`,
              dedupeKey: changeRequestDedupeKey(changeRequest.id, "raised"),
            },
          ],
          1,
        );
      } catch {
        // Deliberately swallowed; the request is committed and visible on the
        // employee's mid-year screen whether or not the notification landed.
      }

      return created({ changeRequest: serializeChangeRequest(changeRequest) });
    } catch (error) {
      // The partial unique index `WHERE status = 'PENDING'` is the arbiter. Two
      // pending requests are each validated against the CURRENT set, so both can
      // total 100 alone and still leave the set off 100 once both are approved —
      // §5.3 broken by two individually-legal acts. A route-level pre-check
      // cannot close that across two requests in flight; this can.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return err(
          "This participant already has a change request awaiting HR's decision. Wait for it to " +
            "be decided, or withdraw it and raise a new one (§6.2).",
          409,
        );
      }
      throw error;
    }
  }),
  { id: "pms-change-request-write", limit: 30, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);

    const statusParam = searchParams.get("status");
    const participantId = searchParams.get("participantId");

    // Visibility, expressed as a WHERE rather than as a post-filter, so the page
    // size means what it says: filtering after the fact returns short pages and
    // makes "no results" indistinguishable from "none you may see".
    let scope: Prisma.KpiChangeRequestWhereInput;
    if (actor.capabilities.orgWide) {
      scope = {};
    } else if (actor.employeeId) {
      const descendants = await descendantEmployeeIds(actor.employeeId);
      scope = {
        OR: [
          // Requests about anyone in the actor's chain …
          { participant: { employeeId: { in: [...descendants] } } },
          // … and about the actor themselves, so an employee can see that their
          // own manager has asked HR to change their KPIs. §6.2 gives HR's
          // rejection reason to the manager; nothing in §6 makes the REQUEST
          // itself confidential from its subject, and a change to someone's
          // goals that they cannot see is not a goal they agreed to (§5.1).
          { participant: { employeeId: actor.employeeId } },
        ],
      };
    } else {
      // No employee record — no participants, so no requests (ADR-065).
      scope = { id: { in: [] } };
    }

    const where: Prisma.KpiChangeRequestWhereInput = {
      ...scope,
      ...(statusParam && ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(statusParam)
        ? { status: statusParam as Prisma.EnumChangeRequestStatusFilter["equals"] }
        : {}),
      ...(participantId ? { participantId } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.kpiChangeRequest.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        select: CHANGE_REQUEST_SELECT,
        // Pending first, then most recent: HR opens this screen to find what is
        // waiting on them, not to browse history.
        orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      }),
      prisma.kpiChangeRequest.count({ where }),
    ]);

    return ok(paginatedResponse(rows.map(serializeChangeRequest), total, pagination));
  }),
  { id: "pms-change-request-read", limit: 120, windowMs: 60_000 },
);
