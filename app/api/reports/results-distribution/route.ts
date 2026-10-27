import { NextRequest } from "next/server";
import type { Band } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import {
  BANDS,
  distributionGap,
  isCurveEligible,
  tally,
  type Distribution,
} from "@/lib/pms/calibration";

/**
 * §13.5 — "Results distribution report — band breakdown per department / entity /
 * org-wide (also feeds calibration)."
 *
 * That parenthesis is the design constraint. §10.3 gives HR a target curve and
 * asks the system to show "the gap between actual and target", and §10.4 is
 * explicit that the curve is "guided, not forced". So this report and the
 * calibration screen read the SAME `tally` and `distributionGap` — if the report
 * counted bands differently from the tool HR calibrates with, HR would be
 * closing a gap that the report says is still open.
 *
 * ## Two distributions per group, not one
 *
 * §10.1 — "raw scores are never overwritten; calibration is a separate, audited
 * layer." Showing only the calibrated distribution hides how much the curve
 * moved; showing only the raw one hides the outcome. Both are returned, and the
 * gap is measured against the CALIBRATED one because that is what people were
 * actually placed in.
 *
 * ## The curve applies where §10.3 says it applies
 *
 * "Department-level curve with a minimum group size (≥5); smaller departments
 * roll up." `isCurveEligible` is the shared predicate, and a group below the
 * threshold is returned with `curveEligible: false` rather than with a gap
 * computed against a target that §10.3 says does not apply to it.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgWide) {
      return err("Org-wide reporting is HR's and the executive viewers'.", 403);
    }

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, year: true },
    });
    if (!cycle) return notFound("Cycle");

    const runs = await prisma.scoreRun.findMany({
      where: { cycleId },
      take: 1,
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true, scoredCount: true, skippedCount: true },
    });
    if (runs.length === 0) {
      return ok({
        cycleId,
        year: cycle.year,
        run: null,
        orgWide: null,
        byDepartment: [],
        byEntity: [],
      });
    }

    const [scores, target] = await Promise.all([
      prisma.employeeScore.findMany({
        where: { scoreRunId: runs[0].id },
        take: 4000,
        select: {
          rawBand: true,
          calibratedBand: true,
          employee: {
            select: {
              department: { select: { id: true, name: true } },
              entity: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.calibrationTarget.findUnique({
        where: { cycleId },
        select: {
          outstandingPct: true,
          excellentPct: true,
          targetPct: true,
          almostAchievedPct: true,
          unsatisfactoryPct: true,
          minDepartmentSize: true,
        },
      }),
    ]);

    const targetPct: Distribution | null = target
      ? {
          OUTSTANDING: Number(target.outstandingPct),
          EXCELLENT: Number(target.excellentPct),
          TARGET: Number(target.targetPct),
          ALMOST_ACHIEVED: Number(target.almostAchievedPct),
          UNSATISFACTORY: Number(target.unsatisfactoryPct),
        }
      : null;

    // §10.3 — "minimum group size (≥5) … an editable setting controlled by HR
    // Super Admin." Defaulted here to the same 5 the schema defaults to, so a
    // cycle with no target row yet still reports curve eligibility honestly.
    const minGroup = target?.minDepartmentSize ?? 5;

    type Row = { calibratedBand: Band; rawBand: Band };
    const summarise = (rows: readonly Row[]) => {
      const calibrated = tally(rows.map((r) => r.calibratedBand));
      const raw = tally(rows.map((r) => r.rawBand));
      const curveEligible = isCurveEligible(rows.length, minGroup);
      return {
        headcount: rows.length,
        curveEligible,
        calibrated,
        raw,
        // §10.4 — "guided, not forced". The gap is information; nothing here
        // refuses a distribution for being off-curve.
        // §10.3 — a group below the minimum has no curve of its own ("smaller
        // departments roll up"), so no gap is computed against a target that
        // does not apply to it. Null, not zero: zero would read as "on target".
        gap:
          targetPct && curveEligible
            ? distributionGap({ actual: calibrated, targetPct, headcount: rows.length })
            : null,
        // How far calibration moved this group, per band. §10.1's separate layer,
        // made visible rather than inferred.
        movement: Object.fromEntries(BANDS.map((b) => [b, calibrated[b] - raw[b]])) as Record<
          Band,
          number
        >,
      };
    };

    const group = (pick: (s: (typeof scores)[number]) => { id: string; name: string } | null) => {
      const groups = new Map<string, { name: string | null; rows: Row[] }>();
      const unassigned: Row[] = [];
      for (const s of scores) {
        const key = pick(s);
        if (!key) {
          unassigned.push(s);
          continue;
        }
        const bucket = groups.get(key.id);
        if (bucket) bucket.rows.push(s);
        else groups.set(key.id, { name: key.name, rows: [s] });
      }
      const out: Array<{ id: string; name: string | null } & ReturnType<typeof summarise>> = [
        ...groups.entries(),
      ]
        .map(([id, g]) => ({ id, name: g.name, ...summarise(g.rows) }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      // §1.2's C-Level have no department. Returned as their own group rather
      // than dropped, so the department rows plus this one reconcile to the
      // org-wide headcount.
      if (unassigned.length > 0) {
        out.push({ id: "", name: null, ...summarise(unassigned) });
      }
      return out;
    };

    return ok({
      cycleId,
      year: cycle.year,
      run: {
        startedAt: runs[0].startedAt,
        scoredCount: runs[0].scoredCount,
        skippedCount: runs[0].skippedCount,
      },
      targetPct,
      orgWide: summarise(scores),
      byDepartment: group((s) => s.employee.department),
      byEntity: group((s) => s.employee.entity),
    });
  }),
  { id: "pms-report-distribution", limit: 60, windowMs: 60_000 },
);
