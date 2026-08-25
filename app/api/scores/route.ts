import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import type { RoleTrack } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import {
  scoreEmployee,
  scoreSplitEmployee,
  type PeriodInputs,
  type ScoreInputs,
} from "@/lib/pms/score-run";
import { formRatio, overallRatio } from "@/lib/pms/three-sixty";

/**
 * §8 — calculate every raw score for a cycle.
 *
 * §10.7's sequencing puts this between "assessments completed & signed" and the
 * calibration gate: "raw scores calculated (all) → HR Super Admin calibration
 * gate". So this is the step that produces the "all".
 *
 * ## Raw scores are written once
 *
 * §10.1 — "Calibration is a separate layer that never overwrites the raw score."
 * A re-run creates a NEW `ScoreRun` rather than updating the last one, so the
 * previous raw numbers survive alongside any calibration already applied to
 * them. Nothing in this route updates an existing `EmployeeScore`.
 *
 * `calibratedBand` starts equal to `rawBand`: §10.1 wants both to exist for
 * everyone from the moment a score does, so an uncalibrated employee has a
 * calibrated band that simply has not moved, rather than a null nobody knows
 * how to read.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR runs the score calculation (§4.1).", 403);
    const startedBy = actor.employeeId;
    if (!startedBy) return err("This account has no linked employee record (ADR-065).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const cycleId = (body as { cycleId?: string }).cycleId;
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, publication: { select: { published: true } } },
    });
    if (!cycle) return notFound("Cycle");
    if (cycle.publication?.published) {
      // §13.2 — results are live. Recomputing underneath a published cycle would
      // change what employees have already read, without anyone deciding to.
      return err(
        "Results for this cycle are published (§13.2). Un-publish before recalculating.",
        409,
      );
    }

    // §8.4's inputs, read once for the whole cycle rather than per employee.
    const [entityScores, departmentScores, participants, threeSixty] = await Promise.all([
      prisma.entityScore.findMany({
        where: { cycleId },
        take: 50,
        select: { entityId: true, score: true },
      }),
      prisma.departmentScore.findMany({
        where: { cycleId },
        take: 500,
        select: { departmentId: true, score: true },
      }),
      prisma.cycleParticipant.findMany({
        where: { cycleId },
        take: 4000,
        select: {
          employee: {
            select: { id: true, roleTrack: true, entityId: true, departmentId: true, status: true },
          },
          kpis: {
            where: { deletedAt: null },
            take: 200,
            select: {
              assignmentPeriodId: true,
              weightage: true,
              ratings: { where: { party: "MANAGER" }, select: { level: true }, take: 1 },
            },
          },
        },
      }),
      prisma.threeSixtyCycle.findUnique({ where: { cycleId }, select: { id: true } }),
    ]);

    // §12.3 — the employees whose year was split by a mid-cycle transfer. Almost
    // always empty; read once for the cycle so the ordinary path pays nothing
    // for the edge case.
    const periodRows = await prisma.employeeAssignmentPeriod.findMany({
      where: { cycleId },
      take: 1000,
      orderBy: [{ employeeId: "asc" }, { orderIndex: "asc" }],
      select: {
        id: true,
        employeeId: true,
        orderIndex: true,
        entityId: true,
        departmentId: true,
        startsOn: true,
        endsOn: true,
      },
    });
    const periodsByEmployee = new Map<string, typeof periodRows>();
    for (const row of periodRows) {
      const bucket = periodsByEmployee.get(row.employeeId);
      if (bucket) bucket.push(row);
      else periodsByEmployee.set(row.employeeId, [row]);
    }

    const byEntity = new Map(entityScores.map((s) => [s.entityId, s.score]));
    const byDepartment = new Map(departmentScores.map((s) => [s.departmentId, s.score]));

    // §9.5's ratios, computed once for the cycle. §8.5 carries them in as × 5.
    const ratioByEmployee = threeSixty
      ? await threeSixtyLevels(threeSixty.id)
      : new Map<string, Prisma.Decimal>();

    const run = await prisma.scoreRun.create({
      data: { cycleId, startedByEmployeeId: startedBy },
      select: { id: true },
    });

    const skipped: { employeeId: string; reason: string }[] = [];
    let scoredCount = 0;

    for (const p of participants) {
      const e = p.employee;

      // §12.3 — a split year takes the day-weighted path instead. Branching on
      // the DATA rather than on a flag: the periods exist only for people who
      // actually transferred, so there is no state to keep in step.
      const split = periodsByEmployee.get(e.id);
      const outcome =
        split && split.length >= 2
          ? scoreSplitEmployee({
              employeeId: e.id,
              roleTrack: e.roleTrack,
              periods: periodInputs(split, p.kpis, byEntity, byDepartment),
              threeSixty: ratioByEmployee.get(e.id) ?? null,
            })
          : scoreEmployee(unsplitInputs(e, p.kpis, byEntity, byDepartment, ratioByEmployee));
      if (!outcome.scored) {
        skipped.push({ employeeId: outcome.employeeId, reason: outcome.reason });
        continue;
      }
      await writeScore(run.id, outcome);
      scoredCount += 1;
    }

    const finished = await prisma.scoreRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), scoredCount, skippedCount: skipped.length },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        scoredCount: true,
        skippedCount: true,
      },
    });

    // The skipped list is the point of the response: §10.7 will not let
    // calibration start until everyone is scored, so this is the worklist.
    return created({ run: finished, skipped });
  }),
  { id: "pms-score-run", limit: 10, windowMs: 60_000 },
);

type ScoredKpiRow = {
  assignmentPeriodId: string | null;
  weightage: Prisma.Decimal;
  ratings: { level: number }[];
};

type ScoreLookup = ReadonlyMap<string, Prisma.Decimal>;

/**
 * §9.5's per-employee ratio, ×5 for §8.5, computed once for the whole cycle.
 *
 * Extracted from the handler because it is a self-contained read-and-fold with
 * no bearing on the scoring loop's control flow — and because a 360 consolidated
 * differently here than in `/api/scorecard` would let an employee's own screen
 * disagree with the score they were given.
 */
async function threeSixtyLevels(threeSixtyCycleId: string): Promise<Map<string, Prisma.Decimal>> {
  const submitted = await prisma.assignment.findMany({
    where: { threeSixtyCycleId, status: "SUBMITTED" },
    take: 8000,
    select: {
      rateeId: true,
      responses: { select: { score: true, question: { select: { id: true } } }, take: 60 },
      template: { select: { questions: { select: { id: true, scored: true }, take: 60 } } },
    },
  });
  const acc = new Map<string, Prisma.Decimal[]>();
  for (const a of submitted) {
    const answered = new Map(a.responses.map((r) => [r.question.id, r.score]));
    const ratio = formRatio(
      a.template.questions.map((q) => ({
        scored: q.scored,
        score: q.scored ? (answered.get(q.id) ?? null) : null,
      })),
    );
    if (ratio === null) continue;
    acc.set(a.rateeId, [...(acc.get(a.rateeId) ?? []), ratio]);
  }
  const out = new Map<string, Prisma.Decimal>();
  for (const [rateeId, ratios] of acc) {
    const overall = overallRatio(ratios);
    if (overall) out.set(rateeId, overall.times(5));
  }
  return out;
}

/** The ordinary, un-split employee — §8.6 applied to one whole year. */
function unsplitInputs(
  employee: { id: string; roleTrack: RoleTrack; entityId: string; departmentId: string | null },
  kpis: readonly ScoredKpiRow[],
  byEntity: ScoreLookup,
  byDepartment: ScoreLookup,
  ratioByEmployee: ScoreLookup,
): ScoreInputs {
  return {
    employeeId: employee.id,
    roleTrack: employee.roleTrack,
    corporate: byEntity.get(employee.entityId) ?? null,
    departmental: employee.departmentId ? (byDepartment.get(employee.departmentId) ?? null) : null,
    // §8.2 scores the MANAGER's rating — §7.1 makes the manager's review the
    // final rating both parties sign, and the self-assessment is the input to
    // that conversation rather than a second score.
    kpis: kpis
      .filter((k) => k.ratings.length > 0)
      .map((k) => ({ level: k.ratings[0].level, weightage: k.weightage })),
    threeSixty: ratioByEmployee.get(employee.id) ?? null,
  };
}

/**
 * §12.3's per-period inputs — each period's own KPI set, and the Corporate and
 * Departmental scores of the department the employee sat in AT THE TIME.
 */
function periodInputs(
  periods: ReadonlyArray<{
    id: string;
    orderIndex: number;
    entityId: string;
    departmentId: string | null;
    startsOn: Date;
    endsOn: Date;
  }>,
  kpis: readonly ScoredKpiRow[],
  byEntity: ScoreLookup,
  byDepartment: ScoreLookup,
): PeriodInputs[] {
  return periods.map((period) => ({
    orderIndex: period.orderIndex,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    corporate: byEntity.get(period.entityId) ?? null,
    departmental: period.departmentId ? (byDepartment.get(period.departmentId) ?? null) : null,
    kpis: kpis
      .filter((k) => k.assignmentPeriodId === period.id && k.ratings.length > 0)
      .map((k) => ({ level: k.ratings[0].level, weightage: k.weightage })),
  }));
}

/**
 * One stored score. Shared by the ordinary and the §12.3 split paths so the two
 * cannot differ in what they persist — a split employee's row must be readable
 * by every reader that reads an unsplit one.
 */
async function writeScore(
  scoreRunId: string,
  outcome: Extract<ReturnType<typeof scoreEmployee>, { scored: true }>,
): Promise<void> {
  await prisma.employeeScore.create({
    data: {
      scoreRunId,
      employeeId: outcome.employeeId,
      corporateScore: outcome.corporate,
      departmentalScore: outcome.departmental,
      individualScore: outcome.individual,
      threeSixtyScore: outcome.threeSixty,
      rawScore: outcome.raw,
      rawBand: outcome.band,
      // §10.1 — both exist from the start; calibration moves only this one.
      calibratedBand: outcome.band,
    },
    select: { id: true },
  });
}

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgWide) {
      return err("Score runs are visible to HR and the executive viewers (§4.1).", 403);
    }
    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const runs = await prisma.scoreRun.findMany({
      where: { cycleId },
      take: 20,
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        scoredCount: true,
        skippedCount: true,
        startedByEmployee: { select: { id: true, name: true } },
      },
    });
    const participantCount = await prisma.cycleParticipant.count({ where: { cycleId } });
    return ok({ runs, participantCount, latestRunId: runs[0]?.id ?? null });
  }),
  { id: "pms-score-read", limit: 60, windowMs: 60_000 },
);
