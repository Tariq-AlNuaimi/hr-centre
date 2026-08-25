import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { GOAL_SETTING_STAGE, kpiSetAccessRefusal } from "@/lib/pms/kpi";
import { KPI_SELECT, serializeKpi, weightageSummary } from "@/lib/pms/kpi-select";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { createKpiSchema } from "@/lib/validations/kpi";

/**
 * KPI drafting — spec §5.2 (what a manager authors) and §5.1 / §5.4 / §4.2 (when
 * they may).
 *
 * Every gate on a write funnels through `kpiEditBlockedReason` (lib/pms/kpi.ts).
 * This route deliberately re-implements none of it: the drafting UI's live
 * banner, this route, and Phase 3's change-request path all have to agree about
 * WHY an edit is refused, and they only do that if there is one sentence to
 * agree with. A refusal comes back as **409** carrying that exact sentence.
 *
 * Two checks sit OUTSIDE that helper because they are not about the edit at all:
 *
 *   - Visibility (§4.2). An actor who cannot even SEE this employee gets 404,
 *     never 403 — a manager probing participant ids must not be able to learn
 *     that a row exists outside their chain from the status code. Same reasoning
 *     as app/api/employees/[id]/route.ts.
 *   - §8.3. "C-Level skip goal-setting entirely." There is no KPI set to author
 *     for them, so the refusal is categorical rather than a timing or authority
 *     question, and it is answered before the stage is even consulted.
 */

/** The KPI columns any caller of this route gets back. */

/**
 * Transport shape. `weightage` is a Decimal and leaves as a STRING: §5.3
 * compares a sum against exactly 100, and the moment the figure becomes a JSON
 * number the client is summing floats.
 */

/**
 * The set-level summary every write returns alongside the row it changed, so the
 * drafting screen can render §5.3's live total without a second request.
 *
 * Read back through the participant rather than `prisma.kpi.findMany` so the
 * query stays a single bounded nested select — a KPI set is a handful of rows by
 * §5.3's own arithmetic. `deletedAt: null` is explicit: the soft-delete
 * extension does not cover `Kpi` (see the DELETE handler's note).
 */
// Not exported: a Next route module may only export HTTP verbs and segment

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const now = new Date();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createKpiSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const input = parsed.data;

    const participant = await prisma.cycleParticipant.findUnique({
      where: { id: input.participantId },
      select: {
        id: true,
        goalsApprovedAt: true,
        // Narrow, enumerated columns — never `include: { employee: true }`, which
        // would pull `basicSalary` (Restricted, §4.5) into a drafting response.
        employee: { select: { id: true, managerId: true, roleTrack: true } },
        cycle: {
          select: {
            id: true,
            status: true,
            stages: {
              where: { kind: GOAL_SETTING_STAGE },
              select: { kind: true, opensAt: true, deadline: true, graceDays: true },
            },
          },
        },
      },
    });
    if (!participant) return notFound("Participant");

    const descendants = actor.capabilities.orgWide
      ? new Set<string>()
      : actor.employeeId
        ? await descendantEmployeeIds(actor.employeeId)
        : new Set<string>();

    // §4.2 → §8.3 → §2 → §5.4/§5.1, in one place. The RSC drafting page reads
    // through Prisma directly (the template's blessed pattern) and so cannot go
    // through this route — it calls the same function rather than restating the
    // ordering and the sentences, which is what it used to do.
    const refusal = kpiSetAccessRefusal({
      actor,
      visible: canViewEmployee(actor, participant.employee.id, descendants),
      employee: participant.employee,
      cycleStatus: participant.cycle.status,
      stage: participant.cycle.stages[0] ?? null,
      goalsApprovedAt: participant.goalsApprovedAt,
      now,
    });
    if (refusal) {
      return refusal.status === 404 ? notFound("Participant") : err(refusal.reason, 409);
    }
    // §5.3 is a SET-level rule checked at sign-off, not a per-row constraint: a
    // draft mid-edit legitimately sits at 80%. The total is REPORTED here so the
    // screen can show the gap, never used to refuse the save.
    const kpi = await prisma.kpi.create({
      data: {
        participantId: participant.id,
        description: input.description,
        weightage: input.weightage,
        descriptorOutstanding: input.descriptorOutstanding,
        descriptorExcellent: input.descriptorExcellent,
        descriptorTarget: input.descriptorTarget,
        descriptorAlmostAchieved: input.descriptorAlmostAchieved,
        descriptorUnsatisfactory: input.descriptorUnsatisfactory,
        orderIndex: input.orderIndex,
      },
      select: KPI_SELECT,
    });

    return created({ kpi: serializeKpi(kpi), set: await weightageSummary(participant.id) });
  }),
  { id: "pms-kpi-write", limit: 60, windowMs: 60_000 },
);
