import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { updateCycleStagesSchema } from "@/lib/validations/cycle";

/**
 * Stage deadlines — spec §2 ("HR sets deadlines for each stage") and §5.5.
 *
 * Editing a deadline on an OPEN cycle is not an escape hatch, it is one of the
 * three formal interventions §5.5 gives HR when a stage has gone past grace:
 * "extend the deadline, intervene directly, or mark a formal non-compliance
 * event". It runs through the audit extension like any other write, so an
 * extension is visible as a decision someone made rather than as a deadline
 * that quietly moved.
 *
 * A CLOSED cycle is immutable: §10's calibration and §13's publish gate both
 * assume a finished year stops moving.
 */
export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateCycleStagesSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: { id: true, status: true, year: true },
    });
    if (!cycle) return notFound("Cycle");
    if (cycle.status === "CLOSED") {
      return err(`The ${cycle.year} cycle is closed; its deadlines can no longer change.`, 409);
    }

    const kinds = parsed.data.stages.map((s) => s.kind);
    if (new Set(kinds).size !== kinds.length) {
      return err("Each touchpoint may appear only once in a single update");
    }

    // pillar:scalable-ok: bounded at 3 by domain — §2 fixes exactly three
    // touchpoints, CycleStageKind has three members, and @@unique([cycleId, kind])
    // makes a fourth row unrepresentable. `kinds` is itself capped at 3 by zod.
    const existing = await prisma.cycleStage.findMany({
      where: { cycleId: id, kind: { in: kinds } },
      select: { id: true, kind: true },
    });
    const byKind = new Map(existing.map((s) => [s.kind, s.id]));
    const missing = kinds.filter((k) => !byKind.has(k));
    if (missing.length > 0) {
      return err(`This cycle has no ${missing.join(", ")} stage to update`);
    }

    // One update per stage rather than a bulk write: the audit trail should say
    // which deadline moved, and `no-unaudited-bulk-write` enforces that.
    for (const stage of parsed.data.stages) {
      await prisma.cycleStage.update({
        where: { id: byKind.get(stage.kind) as string },
        data: { opensAt: stage.opensAt, deadline: stage.deadline, graceDays: stage.graceDays },
      });
    }

    // pillar:scalable-ok: same bound — one cycle has at most three stages.
    const stages = await prisma.cycleStage.findMany({
      where: { cycleId: id },
      orderBy: { opensAt: "asc" },
      select: { id: true, kind: true, opensAt: true, deadline: true, graceDays: true },
    });
    return ok(stages);
  }),
  { id: "pms-cycle-stages-write", limit: 30, windowMs: 60_000 },
);
