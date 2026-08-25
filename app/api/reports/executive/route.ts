import { NextRequest } from "next/server";
import type { Band } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { bonusRows, bonusTotals } from "@/lib/pms/bonus-report";
import { BANDS, tally } from "@/lib/pms/calibration";
import { stageState } from "@/lib/pms/cycle";
import { canViewCompensation } from "@/lib/pms/permissions";
import { stageProgress } from "@/lib/pms/status";
import { participantStatuses } from "@/lib/pms/status-query";

/**
 * §13.6 — the executive dashboard (COO / Ops Director).
 *
 * "Aggregate-first: org-wide band distributions across departments and entities,
 * completion health, compliance picture, bonus totals. Full drill-down on demand
 * into any individual's complete record, including salary/bonus. Read-only
 * throughout."
 *
 * Four aggregates in one response, because "aggregate-first" describes a screen
 * that opens with all four visible rather than four screens someone navigates
 * between. Drill-down is deliberately NOT here: it is the existing per-employee
 * surfaces (`/api/employees/[id]`, `/api/scorecard`, `/api/bonus`), each of which
 * already enforces §4.5 and §11.6 for itself. Re-implementing the individual
 * record inside a dashboard route would be a second place for that check to be
 * got wrong.
 *
 * ## Read-only is a property of the route, not of the UI
 *
 * There is no POST here and no mutation anywhere in the file. §13.6's
 * "read-only throughout" is therefore true of the API, not merely of the screen
 * an executive happens to be shown — `isReadOnly` hides buttons, but the absence
 * of a write path is what makes it enforceable.
 *
 * ## Bonus totals respect §11.6
 *
 * Bonus totals are returned only to `canViewCompensation` — which §4.5 defines as
 * HR plus the COO and Ops Director, exactly the audience of this dashboard. An
 * actor with org-wide sight but no compensation right (there is none today, but
 * the check does not assume that) gets every other aggregate and a null here.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgWide) {
      return err("The executive dashboard is for HR and top management (§13.6).", 403);
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
      },
    });
    if (!cycle) return notFound("Cycle");

    const now = new Date();
    const goalStage = cycle.stages.find((s) => s.kind === "GOAL_SETTING") ?? null;
    const goalStageLocked = goalStage ? stageState(goalStage, now) === "LOCKED" : false;

    // Completion health — the same engine the manager workspace reads (§13.4).
    const { rows, truncated } = await participantStatuses({
      cycleId,
      scope: null,
      goalStageLocked,
      includeScores: true,
    });

    const [distribution, compliance, publication] = await Promise.all([
      bandDistribution(cycleId),
      compliancePicture(cycleId),
      prisma.cyclePublication.findUnique({
        where: { cycleId },
        select: { published: true, publishedAt: true },
      }),
    ]);

    // §11.6 — the bonus total is compensation, and gated as such.
    const bonus = canViewCompensation(actor) ? await cycleBonusTotals(cycleId, cycle.year) : null;

    return ok({
      cycle: {
        id: cycle.id,
        year: cycle.year,
        status: cycle.status,
        published: publication?.published ?? false,
        publishedAt: publication?.publishedAt ?? null,
      },
      completion: { participantCount: rows.length, truncated, progress: stageProgress(rows) },
      distribution,
      compliance,
      bonus,
    });
  }),
  { id: "pms-report-executive", limit: 60, windowMs: 60_000 },
);

/**
 * Calibrated band counts, org-wide and per group.
 *
 * The calibrated band, not the raw one: §11.3 pays from it and §13.1 shows it,
 * so it is the distribution the organisation actually has. The raw-vs-calibrated
 * comparison lives on the results-distribution report, which is where someone
 * asking about the curve would go.
 */
async function bandDistribution(cycleId: string) {
  const runs = await prisma.scoreRun.findMany({
    where: { cycleId },
    take: 1,
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (runs.length === 0) return null;

  const scores = await prisma.employeeScore.findMany({
    where: { scoreRunId: runs[0].id },
    take: 4000,
    select: {
      calibratedBand: true,
      employee: {
        select: {
          department: { select: { name: true } },
          entity: { select: { name: true } },
        },
      },
    },
  });

  const group = (pick: (s: (typeof scores)[number]) => string | null) => {
    const buckets = new Map<string | null, Band[]>();
    for (const s of scores) {
      const key = pick(s);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(s.calibratedBand);
      else buckets.set(key, [s.calibratedBand]);
    }
    return [...buckets.entries()]
      .map(([name, bands]) => ({ name, headcount: bands.length, bands: tally(bands) }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  };

  return {
    orgWide: { headcount: scores.length, bands: tally(scores.map((s) => s.calibratedBand)) },
    byDepartment: group((s) => s.employee.department?.name ?? null),
    byEntity: group((s) => s.employee.entity.name),
    bandOrder: BANDS,
  };
}

/**
 * §13.6's "compliance picture" — the headline numbers from §5.6's record.
 *
 * Counts, not a list of names: a dashboard that opened with a leaderboard of
 * managers would make an accountability report into a public ranking. The named
 * detail is one click away on the manager-compliance report, which is where
 * §13.5 puts it.
 */
async function compliancePicture(cycleId: string) {
  const events = await prisma.complianceEvent.findMany({
    where: { cycleId },
    take: 4000,
    select: { kind: true, managerEmployeeId: true },
  });
  const managers = new Set<string>();
  let misses = 0;
  let escalations = 0;
  let interventions = 0;
  for (const e of events) {
    if (e.kind === "DEADLINE_MISSED") {
      misses += 1;
      if (e.managerEmployeeId) managers.add(e.managerEmployeeId);
    }
    if (e.kind === "ESCALATED_SKIP_LEVEL" || e.kind === "ESCALATED_HR") escalations += 1;
    if (e.kind === "HR_EXTENDED_DEADLINE" || e.kind === "HR_MARKED_NON_COMPLIANT") {
      interventions += 1;
    }
  }
  return { misses, escalations, interventions, managersInvolved: managers.size };
}

/**
 * §13.6's "bonus totals" — the payroll figure, summed.
 *
 * Reuses `bonusRows`, so the total on this dashboard is the sum of the exact
 * rows in §11.7's export, and `bonusTotals` so it is the same fold the §13.5
 * bonus report shows. Two independent sums of "the bonus" would eventually
 * disagree, and the one an executive sees should never be the one that is wrong.
 */
async function cycleBonusTotals(cycleId: string, year: number) {
  const rows = await bonusRows({ cycleId, year });
  if (rows === null) return null;
  return bonusTotals(rows);
}
