import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import type { RoleTrack } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { clampToService } from "@/lib/pms/transfer";
import { countableParticipantWhere } from "@/lib/pms/cycle";
import {
  scoreEmployee,
  scoreSplitEmployee,
  type PeriodInputs,
  type ScoreInputs,
} from "@/lib/pms/score-run";
import { formRatio, overallRatio } from "@/lib/pms/three-sixty";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
import { CYCLE_POLICY_SELECT, policyFor } from "@/lib/pms/cycle-policy";

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
    if (!isHr(actor)) return err("Only HR runs the score calculation.", 403);
    const startedBy = actor.employeeId;
    if (!startedBy) return err("This account has no linked employee record (ADR-065).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const cycleId = (body as { cycleId?: string }).cycleId;
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        publication: { select: { published: true } },
        // §8.7's banding rule for THIS cycle. Read here, once per run, rather
        // than per employee: it cannot change mid-run (the policy is frozen the
        // moment a cycle leaves DRAFT, and §8 only scores an OPEN one), and one
        // score run must band every employee by the same rule or the cohort is
        // not comparable — which is exactly what §10's calibration assumes.
        ...CYCLE_POLICY_SELECT,
      },
    });
    if (!cycle) return notFound("Cycle");
    if (cycle.publication?.published) {
      // §13.2 — results are live. Recomputing underneath a published cycle would
      // change what employees have already read, without anyone deciding to.
      return err("Results for this cycle are published. Un-publish before recalculating.", 409);
    }

    // Resolved once, from the cycle. `policyFor` tolerates a cycle created
    // before these columns existed and returns the behaviour the code had then.
    const policy = policyFor(cycle);

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
      // The SAME predicate the gate counts with. If these two disagreed,
      // `scoredCount` could exceed `participantCount` and §10.7's gate would
      // read as complete while somebody was still unscored. (Comment kept
      // ABOVE the call: `/ship`'s scalability scan reads only 250 characters
      // past `findMany(` looking for the bound, and deliberately will not let a
      // comment satisfy it — so a comment in between hides a real `take`.)
      prisma.cycleParticipant.findMany({
        where: countableParticipantWhere(cycleId),
        take: 4000,
        select: {
          employee: {
            select: {
              id: true,
              roleTrack: true,
              entityId: true,
              departmentId: true,
              status: true,
              // §12.3's periods are clamped to actual service before they are
              // weighted — see `clampToService`.
              dateOfJoining: true,
              lastWorkingDay: true,
            },
          },
          // §10.7 — "assessments completed & signed" comes BEFORE the score
          // run, so the signatures are an input to it.
          signOffs: {
            where: { stageKind: YEAR_END_STAGE },
            select: { party: true },
          },
          kpis: {
            where: { deletedAt: null },
            take: 200,
            select: {
              assignmentPeriodId: true,
              description: true,
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
      : new Map<string, ThreeSixtyFigure>();

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
              periods: periodInputs(split, p.kpis, byEntity, byDepartment, {
                dateOfJoining: e.dateOfJoining,
                lastWorkingDay: e.lastWorkingDay,
              }),
              threeSixty: ratioByEmployee.get(e.id)?.level ?? null,
              // §10.7 — the same precondition on both paths; a transfer does
              // not excuse the signatures.
              signedParties: p.signOffs.map((s) => s.party),
              policy,
            })
          : scoreEmployee({
              ...unsplitInputs(e, p.kpis, byEntity, byDepartment, ratioByEmployee),
              signedParties: p.signOffs.map((s) => s.party),
              policy,
            });
      if (!outcome.scored) {
        skipped.push({ employeeId: outcome.employeeId, reason: outcome.reason });
        continue;
      }
      // The count belongs to the 360 figure, not to the score: `scoreEmployee`
      // never sees it, because an input it does not use has no business being
      // in its signature (F8 — visible only, no arithmetic, no gate).
      await writeScore(run.id, outcome, ratioByEmployee.get(e.id)?.raterCount ?? null);
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
  description: string;
  weightage: Prisma.Decimal;
  ratings: { level: number }[];
};

type ScoreLookup = ReadonlyMap<string, Prisma.Decimal>;

/**
 * §9.5's consolidated figure and the denominator it was averaged over.
 *
 * The pair travels together from here to the stored row, because the count is
 * only meaningful ABOUT that particular score. `level` is the ×5 form §8.5
 * takes; `raterCount` is not an input to any arithmetic (red-team F8) — it is
 * carried so a human reading the score can see how thin its 360 was.
 */
type ThreeSixtyFigure = { level: Prisma.Decimal; raterCount: number };

type ThreeSixtyLookup = ReadonlyMap<string, ThreeSixtyFigure>;

/**
 * §9.5's per-employee ratio, ×5 for §8.5, computed once for the whole cycle.
 *
 * Extracted from the handler because it is a self-contained read-and-fold with
 * no bearing on the scoring loop's control flow — and because a 360 consolidated
 * differently here than in `/api/scorecard` would let an employee's own screen
 * disagree with the score they were given.
 */
async function threeSixtyLevels(threeSixtyCycleId: string): Promise<Map<string, ThreeSixtyFigure>> {
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
  const out = new Map<string, ThreeSixtyFigure>();
  for (const [rateeId, ratios] of acc) {
    const overall = overallRatio(ratios);
    // `ratios.length` is exactly the denominator `overallRatio` divided by —
    // forms that produced a usable ratio, not forms assigned and not forms
    // submitted-but-blank. Reading it from the same array the average came from
    // is what makes the stored count and the stored score describe the same
    // thing (F8); recounting assignments separately would eventually not.
    if (overall) out.set(rateeId, { level: overall.times(5), raterCount: ratios.length });
  }
  return out;
}

/** The ordinary, un-split employee — §8.6 applied to one whole year. */
function unsplitInputs(
  employee: { id: string; roleTrack: RoleTrack; entityId: string; departmentId: string | null },
  kpis: readonly ScoredKpiRow[],
  byEntity: ScoreLookup,
  byDepartment: ScoreLookup,
  ratioByEmployee: ThreeSixtyLookup,
  // The signatures and the policy are supplied by the caller, which is the only
  // place that has them; naming them here as absent beats an optional field
  // that a future caller could quietly leave unset (§10.7).
): Omit<ScoreInputs, "signedParties" | "policy"> {
  return {
    employeeId: employee.id,
    roleTrack: employee.roleTrack,
    corporate: byEntity.get(employee.entityId) ?? null,
    departmental: employee.departmentId ? (byDepartment.get(employee.departmentId) ?? null) : null,
    // §8.2 scores the MANAGER's rating — §7.1 makes the manager's review the
    // final rating both parties sign, and the self-assessment is the input to
    // that conversation rather than a second score.
    // NO LONGER FILTERED on having a rating. Dropping the unrated ones left the
    // weightages short of 100, so HR was told "weightages total 70%, not 100" —
    // the goal-setting baseline, when the cause was an unfinished review.
    // `scoreEmployee` reports the missing rating itself.
    kpis: kpis.map((k) => ({
      description: k.description,
      level: k.ratings[0]?.level ?? null,
      weightage: k.weightage,
    })),
    threeSixty: ratioByEmployee.get(employee.id)?.level ?? null,
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
  service: { dateOfJoining: Date | null; lastWorkingDay: Date | null },
): PeriodInputs[] {
  return periods.map((period) => {
    // §12.3's split is written at TRANSFER time, so period 2 runs to the end of
    // the cycle. A departure or a mid-year start recorded before or after that
    // does not rewrite the split — the period records where they SAT, not how
    // long they stayed — so the days are clamped to actual service here, where
    // the weight is computed. Without this a transferred employee who then left
    // in August was still weighted as though they worked the new department
    // through December: their band (and so §11.3's bonus coefficient) came from
    // a full year while §11.4 pro-rated their bonus to the days they worked —
    // the score and the payslip disagreeing about one person's calendar.
    const window = clampToService(period, service);
    return {
      orderIndex: period.orderIndex,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      corporate: byEntity.get(period.entityId) ?? null,
      departmental: period.departmentId ? (byDepartment.get(period.departmentId) ?? null) : null,
      kpis: kpis
        .filter((k) => k.assignmentPeriodId === period.id)
        .map((k) => ({
          description: k.description,
          level: k.ratings[0]?.level ?? null,
          weightage: k.weightage,
        })),
    };
  });
}

/**
 * One stored score. Shared by the ordinary and the §12.3 split paths so the two
 * cannot differ in what they persist — a split employee's row must be readable
 * by every reader that reads an unsplit one.
 */
async function writeScore(
  scoreRunId: string,
  outcome: Extract<ReturnType<typeof scoreEmployee>, { scored: true }>,
  threeSixtyRaterCount: number | null,
): Promise<void> {
  await prisma.employeeScore.create({
    data: {
      scoreRunId,
      employeeId: outcome.employeeId,
      corporateScore: outcome.corporate,
      departmentalScore: outcome.departmental,
      individualScore: outcome.individual,
      threeSixtyScore: outcome.threeSixty,
      // Null unless there is a score for it to be the denominator of — the
      // `employee_scores_rater_count_needs_score_check` constraint says the same
      // thing in the database, so a future writer cannot record a count for a
      // 360 that is not there (a C-Level row, §8.3, is null in both).
      threeSixtyRaterCount: outcome.threeSixty === null ? null : threeSixtyRaterCount,
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
      return err("Score runs are visible to HR and the executive viewers.", 403);
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
    // The same predicate again — this count is what `ScoreRunPanel` renders as
    // "N of M", so a different denominator here would have the screen disagree
    // with the gate that actually blocks calibration.
    const participantCount = await prisma.cycleParticipant.count({
      where: countableParticipantWhere(cycleId),
    });
    return ok({ runs, participantCount, latestRunId: runs[0]?.id ?? null });
  }),
  { id: "pms-score-read", limit: 60, windowMs: 60_000 },
);
