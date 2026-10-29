import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { STAGE_ORDER, stageState } from "@/lib/pms/stage";

/**
 * P2-2 — "My year": the employee's own performance home for the whole cycle,
 * not just the week results are released.
 *
 * Strictly SELF: the participant is looked up by the caller's own employee id
 * and nothing else, so there is no id parameter to guess and no scope check to
 * get wrong. It carries only what the employee already sees elsewhere — their
 * own KPI set and weights (goal setting), their own mid-year change requests
 * (mid-year), and the stage dates — gathered on one page. Scores, bands and 360
 * feedback stay on `/api/scorecard`, behind §13.2's publish gate; nothing here
 * pre-empts it (§13.1: no raw scores, no mid-process work).
 */

const KPI_CAP = 200;
const REQUEST_CAP = 20;

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.employeeId) {
      return err("This account is not linked to an employee record yet (ADR-065).", 403);
    }
    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        year: true,
        status: true,
        stages: { select: { kind: true, opensAt: true, deadline: true, graceDays: true } },
        publication: { select: { published: true } },
      },
    });
    if (!cycle) return notFound("Cycle");

    const now = new Date();
    const stages = [...cycle.stages]
      .sort((a, b) => STAGE_ORDER.indexOf(a.kind) - STAGE_ORDER.indexOf(b.kind))
      .map((stage) => ({
        kind: stage.kind,
        opensAt: stage.opensAt,
        deadline: stage.deadline,
        state: stageState(stage, now),
      }));

    const participant = await prisma.cycleParticipant.findFirst({
      where: { cycleId, employeeId: actor.employeeId },
      select: {
        id: true,
        goalsApprovedAt: true,
        kpis: {
          where: { deletedAt: null },
          orderBy: { orderIndex: "asc" },
          take: KPI_CAP,
          select: { id: true, description: true, weightage: true },
        },
        changeRequests: {
          orderBy: { requestedAt: "desc" },
          take: REQUEST_CAP,
          select: {
            id: true,
            status: true,
            rationale: true,
            requestedAt: true,
            decidedAt: true,
            decisionReason: true,
          },
        },
      },
    });

    return ok({
      cycle: {
        id: cycle.id,
        year: cycle.year,
        status: cycle.status,
        published: cycle.publication?.published ?? false,
      },
      stages,
      enrolled: participant !== null,
      goalsApprovedAt: participant?.goalsApprovedAt ?? null,
      // Weightage crosses the wire as a string (JSON doubles; §5.3 sums to exactly 100).
      kpis: (participant?.kpis ?? []).map((k) => ({ ...k, weightage: k.weightage.toString() })),
      midYear: participant?.changeRequests ?? [],
    });
  }),
  { id: "pms-my-year", limit: 60, windowMs: 60_000 },
);
