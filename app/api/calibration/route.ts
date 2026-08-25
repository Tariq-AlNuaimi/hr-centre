import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHrSuperAdmin } from "@/lib/pms/permissions";
import {
  adjustmentBlockedReason,
  calibrationReadinessBlockedReason,
  distributionGap,
  emptyDistribution,
  isCurveEligible,
  tally,
} from "@/lib/pms/calibration";
import { adjustSchema, setTargetSchema } from "@/lib/validations/calibration";

/**
 * §10 — the calibration layer.
 *
 * PUT  — define the target distribution (§10.2) and the threshold (§10.3)
 * POST — move one employee's band, with a mandatory reason (§10.5)
 * GET  — target vs actual, per department, so HR can see the gap (§10.4)
 *
 * §10.6 gives all three to **HR Super Admin only**: "HRBP does not touch
 * calibration." That is the single place in the spec where the two HR roles
 * differ on an action, so every handler here checks `isHrSuperAdmin`, not `isHr`.
 *
 * Nothing in this route can change a raw score. §10.1 requires that raw and
 * calibrated both survive, and the only column written is `calibratedBand`.
 */

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHrSuperAdmin(actor)) {
      return err("Only an HR Super Admin defines the target distribution (§10.6).", 403);
    }

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = setTargetSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { cycleId, minDepartmentSize, ...pcts } = parsed.data;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true },
    });
    if (!cycle) return notFound("Cycle");

    const data = {
      outstandingPct: new Prisma.Decimal(pcts.outstandingPct),
      excellentPct: new Prisma.Decimal(pcts.excellentPct),
      targetPct: new Prisma.Decimal(pcts.targetPct),
      almostAchievedPct: new Prisma.Decimal(pcts.almostAchievedPct),
      unsatisfactoryPct: new Prisma.Decimal(pcts.unsatisfactoryPct),
      minDepartmentSize,
    };

    const existing = await prisma.calibrationTarget.findUnique({
      where: { cycleId },
      select: { id: true },
    });
    const row = existing
      ? await prisma.calibrationTarget.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await prisma.calibrationTarget.create({ data: { cycleId, ...data }, select: { id: true } });

    return existing ? ok({ target: row }) : created({ target: row });
  }),
  { id: "pms-calibration-write", limit: 30, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { employeeScoreId, toBand, reason } = parsed.data;

    const score = await prisma.employeeScore.findUnique({
      where: { id: employeeScoreId },
      select: {
        id: true,
        calibratedBand: true,
        scoreRun: {
          select: { cycle: { select: { publication: { select: { published: true } } } } },
        },
      },
    });
    if (!score) return notFound("Employee score");

    const blocked = adjustmentBlockedReason({
      actor,
      fromBand: score.calibratedBand,
      toBand,
      reason,
      published: score.scoreRun.cycle.publication?.published ?? false,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    const adjustedBy = actor.employeeId;
    if (!adjustedBy) return err("This account has no linked employee record (ADR-065).", 403);

    // The adjustment row and the band move are one fact. §10.5 wants "who,
    // from-score, to-score, when, and a mandatory reason" for every override, so
    // a moved band with no adjustment row is exactly the state to prevent.
    await prisma.$transaction(async (tx) => {
      await tx.calibrationAdjustment.create({
        data: {
          employeeScoreId,
          fromBand: score.calibratedBand,
          toBand,
          reason,
          adjustedByEmployeeId: adjustedBy,
        },
        select: { id: true },
      });
      await tx.employeeScore.update({
        where: { id: employeeScoreId },
        // §10.1 — `rawScore` and `rawBand` are NOT touched. Only this column moves.
        data: { calibratedBand: toBand },
        select: { id: true },
      });
    });

    const after = await prisma.employeeScore.findUniqueOrThrow({
      where: { id: employeeScoreId },
      select: {
        id: true,
        rawScore: true,
        rawBand: true,
        calibratedBand: true,
        adjustments: {
          take: 20,
          orderBy: { adjustedAt: "desc" },
          select: {
            fromBand: true,
            toBand: true,
            reason: true,
            adjustedAt: true,
            adjustedByEmployee: { select: { id: true, name: true } },
          },
        },
      },
    });
    return ok({ score: { ...after, rawScore: after.rawScore.toString() } });
  }),
  { id: "pms-calibration-write", limit: 120, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHrSuperAdmin(actor)) {
      return err("Only an HR Super Admin runs calibration (§10.6).", 403);
    }
    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const [target, runs, participantCount] = await Promise.all([
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
      prisma.scoreRun.findMany({
        where: { cycleId },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { id: true },
      }),
      prisma.cycleParticipant.count({ where: { cycleId } }),
    ]);
    const runId = runs[0]?.id ?? null;

    const scores = runId
      ? await prisma.employeeScore.findMany({
          where: { scoreRunId: runId },
          take: 4000,
          select: {
            id: true,
            rawScore: true,
            rawBand: true,
            calibratedBand: true,
            employee: {
              select: {
                id: true,
                name: true,
                status: true,
                department: { select: { id: true, name: true } },
              },
            },
          },
        })
      : [];

    const readiness = calibrationReadinessBlockedReason({
      participantCount,
      scoredCount: scores.length,
      hasTarget: target !== null,
    });

    const targetPct = target
      ? {
          OUTSTANDING: Number(target.outstandingPct),
          EXCELLENT: Number(target.excellentPct),
          TARGET: Number(target.targetPct),
          ALMOST_ACHIEVED: Number(target.almostAchievedPct),
          UNSATISFACTORY: Number(target.unsatisfactoryPct),
        }
      : emptyDistribution();

    // §10.3 — per department, and only those at or above the threshold get a
    // curve. Sub-threshold departments are still LISTED, flagged as exempt:
    // §10.5 keeps manual override available on every department.
    const byDept = new Map<string, { name: string; scores: typeof scores }>();
    for (const s of scores) {
      const key = s.employee.department?.id ?? "none";
      const entry = byDept.get(key) ?? {
        name: s.employee.department?.name ?? "No department",
        scores: [],
      };
      entry.scores.push(s);
      byDept.set(key, entry);
    }

    const minSize = target?.minDepartmentSize ?? 5;
    const departments = [...byDept.entries()].map(([departmentId, v]) => {
      const activeCount = v.scores.filter((s) => s.employee.status === "ACTIVE").length;
      return {
        departmentId,
        name: v.name,
        headcount: v.scores.length,
        activeCount,
        curveEligible: isCurveEligible(activeCount, minSize),
        gap: distributionGap({
          actual: tally(v.scores.map((s) => s.calibratedBand)),
          targetPct,
          headcount: v.scores.length,
        }),
        employees: v.scores.map((s) => ({
          employeeScoreId: s.id,
          employeeId: s.employee.id,
          name: s.employee.name,
          rawScore: s.rawScore.toString(),
          rawBand: s.rawBand,
          calibratedBand: s.calibratedBand,
        })),
      };
    });

    return ok({
      cycleId,
      readiness:
        readiness === null ? { ready: true, reason: null } : { ready: false, reason: readiness },
      minDepartmentSize: minSize,
      target: target ?? null,
      orgWide: distributionGap({
        actual: tally(scores.map((s) => s.calibratedBand)),
        targetPct,
        headcount: scores.length,
      }),
      departments: departments.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }),
  { id: "pms-calibration-read", limit: 60, windowMs: 60_000 },
);
