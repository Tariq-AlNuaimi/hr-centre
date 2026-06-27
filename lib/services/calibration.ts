import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { CompetencyScoreRow } from "@/lib/scoring-rollup";
import {
  buildCalibration,
  selectionRates,
  type CalibrationPair,
  type CalibrationReport,
  type SelectionRateRow,
  MIN_OUTCOMES_FOR_REPORT,
} from "@/lib/calibration";

// Bound the populations the generate + adverse reads pull into memory so a mature,
// high-volume role can't trigger a full-table scan / serverless memory spike
// (senior-review H-1/H-2). Both are surfaced honestly when hit (a truncated adverse
// read flags `capped`; generate's cap is far above MIN and logged if reached).
const MAX_GENERATE_RESULTS = 2000;
const MAX_ADVERSE_RESULTS = 5000;
import type { OutcomeInputBody } from "@/lib/validations/calibration";

// Calibration service (ARCHITECTURE §7, Phase-7 blueprint). Orchestrates the pure
// math (lib/calibration.ts) over tenant-scoped Prisma rows: records post-hire
// outcomes, generates per-role-version calibration reports, and computes the
// org-wide selection-rate / adverse-impact monitor. ADVISORY only — nothing here
// writes a band; applying a suggestion is the existing human new-version flow.
// All reads are orgId-scoped via the audited, soft-delete-filtered `prisma` client.

// ---- Outcome capture ----

export type OutcomeView = {
  id: string;
  resultId: string;
  hired: boolean;
  probationPassed: boolean | null;
  rating6m: number | null;
  rating12m: number | null;
  retained: boolean | null;
  recordedAt: Date;
};

export type RecordOutcomeResult =
  | { kind: "ok"; outcome: OutcomeView }
  | { kind: "not-found" }
  | { kind: "invalid"; message: string }
  | { kind: "conflict"; message: string };

function toOutcomeView(row: {
  id: string;
  resultId: string;
  hired: boolean;
  probationPassed: boolean | null;
  rating6m: number | null;
  rating12m: number | null;
  retained: boolean | null;
  recordedAt: Date;
}): OutcomeView {
  return {
    id: row.id,
    resultId: row.resultId,
    hired: row.hired,
    probationPassed: row.probationPassed,
    rating6m: row.rating6m,
    rating12m: row.rating12m,
    retained: row.retained,
    recordedAt: row.recordedAt,
  };
}

/**
 * Record or correct the post-hire outcome for a Result (1:1). Tenant-scoped: a
 * result outside the org (or whose sitting was soft-deleted) is not-found. Domain
 * rule: post-hire signals are only meaningful for a hire, so a non-hire carrying
 * any of them is rejected (a calm 4xx, never a 500 or a silent success).
 */
export async function recordOutcome(
  orgId: string,
  userId: string | undefined,
  body: OutcomeInputBody
): Promise<RecordOutcomeResult> {
  const probationPassed = body.probationPassed ?? null;
  const rating6m = body.rating6m ?? null;
  const rating12m = body.rating12m ?? null;
  const retained = body.retained ?? null;

  if (!body.hired && (probationPassed !== null || rating6m !== null || rating12m !== null || retained !== null)) {
    return {
      kind: "invalid",
      message: "Post-hire signals (probation, ratings, retention) can only be recorded for a hired candidate.",
    };
  }

  // The result must exist in this org and belong to a live (non-erased) sitting.
  const result = await prisma.result.findFirst({
    where: { id: body.resultId, orgId, assessment: { deletedAt: null } },
    select: { id: true },
  });
  if (!result) return { kind: "not-found" };

  const fields = { hired: body.hired, probationPassed, rating6m, rating12m, retained };

  // Correctable record: update the live row if one exists, else create. A P2002 on
  // create means a soft-deleted outcome holds the unique resultId slot — surface it
  // honestly (restore from the recycling bin) rather than throwing a 500.
  const existing = await prisma.outcomeRecord.findFirst({
    where: { resultId: body.resultId, orgId },
    select: { id: true },
  });
  try {
    const row = existing
      ? await prisma.outcomeRecord.update({
          where: { id: existing.id },
          data: { ...fields, recordedById: userId ?? null, recordedAt: new Date() },
        })
      : await prisma.outcomeRecord.create({
          data: { orgId, resultId: body.resultId, ...fields, recordedById: userId ?? null },
        });
    return { kind: "ok", outcome: toOutcomeView(row) };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        kind: "conflict",
        message: "A removed outcome record exists for this result — restore it from the recycling bin to edit it.",
      };
    }
    throw e;
  }
}

export type OutcomeCaptureRow = {
  resultId: string;
  candidateName: string | null;
  candidateEmail: string;
  roleTitle: string;
  roleFamily: string;
  fitScore: number;
  decision: string | null;
  completedAt: Date | null;
  outcome: OutcomeView | null;
};

/**
 * Paginated list of computed results eligible for outcome capture, each with its
 * current outcome (if recorded). Bounded — drives the capture table (UI-SPEC D.9).
 * Only live results on live sittings; tenant-scoped.
 */
export async function listOutcomeCaptureRows(
  orgId: string,
  opts: { skip: number; take: number }
): Promise<{ data: OutcomeCaptureRow[]; total: number }> {
  const where: Prisma.ResultWhereInput = { orgId, assessment: { deletedAt: null } };
  const [rows, total] = await Promise.all([
    prisma.result.findMany({
      where,
      skip: opts.skip,
      take: opts.take,
      orderBy: { computedAt: "desc" },
      select: {
        id: true,
        fitScore: true,
        decision: true,
        assessment: {
          select: {
            submittedAt: true,
            invitation: {
              select: {
                candidateName: true,
                candidateEmail: true,
                roleProfile: {
                  select: { title: true, roleFamily: { select: { name: true } } },
                },
              },
            },
          },
        },
        outcome: {
          select: {
            id: true,
            resultId: true,
            hired: true,
            probationPassed: true,
            rating6m: true,
            rating12m: true,
            retained: true,
            recordedAt: true,
            deletedAt: true,
          },
        },
      },
    }),
    prisma.result.count({ where }),
  ]);

  const data: OutcomeCaptureRow[] = rows.map((r) => {
    const inv = r.assessment.invitation;
    // The outcome relation is not soft-delete-filtered on this nested read — treat a
    // soft-deleted outcome as absent (same invariant as the Phase-6 result reads).
    const liveOutcome = r.outcome && !r.outcome.deletedAt ? r.outcome : null;
    return {
      resultId: r.id,
      candidateName: inv.candidateName,
      candidateEmail: inv.candidateEmail,
      roleTitle: inv.roleProfile.title,
      roleFamily: inv.roleProfile.roleFamily.name,
      fitScore: r.fitScore,
      decision: r.decision,
      completedAt: r.assessment.submittedAt,
      outcome: liveOutcome ? toOutcomeView(liveOutcome) : null,
    };
  });
  return { data, total };
}

// ---- Calibration report (per role-profile version) ----

export type RoleCalibrationStatus = {
  roleProfileId: string;
  roleTitle: string;
  roleFamily: string;
  version: number;
  outcomeCount: number;
  /** generatedAt of the latest persisted report, or null if never generated. */
  lastGeneratedAt: Date | null;
};

/**
 * The roles an admin can calibrate: each ACTIVE/APPROVED role version with its
 * recorded-outcome count and the timestamp of its latest report. Bounded by the
 * org's role versions; tenant-scoped.
 */
export async function listRoleCalibrationStatus(orgId: string): Promise<RoleCalibrationStatus[]> {
  const profiles = await prisma.roleProfile.findMany({
    where: { orgId, status: { in: ["APPROVED", "ACTIVE"] } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      version: true,
      roleFamily: { select: { name: true } },
      // Match what generateCalibration actually consumes: live results on live
      // sittings with a LIVE (non-erased) outcome. The nested _count is NOT auto
      // soft-delete-filtered, so scope all three explicitly — otherwise the list
      // shows a higher "recorded outcomes" count than generate can use. (This is
      // still the recorded count; the report further needs hired+signal, so the
      // generated sample may be smaller — that's surfaced in the insufficient state.)
      _count: {
        select: {
          results: {
            where: {
              deletedAt: null,
              assessment: { is: { deletedAt: null } },
              outcome: { is: { deletedAt: null } },
            },
          },
        },
      },
      calibrations: {
        orderBy: { generatedAt: "desc" },
        take: 1,
        select: { generatedAt: true },
      },
    },
  });
  return profiles.map((p) => ({
    roleProfileId: p.id,
    roleTitle: p.title,
    roleFamily: p.roleFamily.name,
    version: p.version,
    outcomeCount: p._count.results,
    lastGeneratedAt: p.calibrations[0]?.generatedAt ?? null,
  }));
}

export type GenerateCalibrationResult =
  | { kind: "ok"; report: CalibrationReport; sampleSize: number; generatedAt: Date }
  | { kind: "insufficient"; have: number; need: number }
  | { kind: "not-found" };

/**
 * Generate (and persist, when sufficient) a calibration report for one role-profile
 * version. Loads every live result for the role that has a recorded outcome, runs
 * the pure `buildCalibration`, and on success writes a new append-only
 * `ProfileCalibration` row (history). ADVISORY: the report only suggests band
 * directions; it never writes a band.
 */
export async function generateCalibration(
  orgId: string,
  userId: string | undefined,
  roleProfileId: string
): Promise<GenerateCalibrationResult> {
  const profile = await prisma.roleProfile.findFirst({
    where: { id: roleProfileId, orgId },
    select: { id: true, version: true },
  });
  if (!profile) return { kind: "not-found" };

  // The outcome-recorded population for this role version — domain-bounded (one
  // role's hires), not user-paginated: the stats need every point. Capped at
  // MAX_GENERATE_RESULTS so a very high-volume role can't pin memory (the cap is far
  // above MIN_OUTCOMES_FOR_REPORT; a hit is logged for ops). The outcome relation is
  // filtered to LIVE (non-erased) outcomes at the DB level — not an in-memory guard.
  const rows = await prisma.result.findMany({
    where: { orgId, roleProfileId, assessment: { deletedAt: null }, outcome: { is: { deletedAt: null } } },
    take: MAX_GENERATE_RESULTS,
    select: {
      fitScore: true,
      competencyScores: true,
      outcome: {
        select: { hired: true, probationPassed: true, rating6m: true, rating12m: true, retained: true },
      },
    },
  });
  if (rows.length === MAX_GENERATE_RESULTS) {
    console.warn(
      `[calibration.generate] role ${roleProfileId} hit the ${MAX_GENERATE_RESULTS}-result cap; report computed on a capped sample`
    );
  }

  const pairs: CalibrationPair[] = rows
    .filter((r) => r.outcome) // DB already excluded absent/soft-deleted outcomes; narrow the type
    .map((r) => {
      const comps = (r.competencyScores as unknown as CompetencyScoreRow[]).map((c) => ({
        name: c.name,
        score: c.score,
        band: c.band,
      }));
      const o = r.outcome!;
      return {
        fitScore: r.fitScore,
        competencies: comps,
        outcome: {
          hired: o.hired,
          probationPassed: o.probationPassed,
          rating6m: o.rating6m,
          rating12m: o.rating12m,
          retained: o.retained,
        },
      };
    });

  const outcome = buildCalibration(pairs);
  if (outcome.kind === "insufficient") return outcome;

  const saved = await prisma.profileCalibration.create({
    data: {
      orgId,
      roleProfileId: profile.id,
      version: profile.version,
      metrics: outcome.report as unknown as Prisma.InputJsonValue,
      sampleSize: outcome.report.sampleSize,
      generatedById: userId ?? null,
    },
    select: { generatedAt: true },
  });
  return { kind: "ok", report: outcome.report, sampleSize: outcome.report.sampleSize, generatedAt: saved.generatedAt };
}

export type StoredCalibration = {
  report: CalibrationReport;
  sampleSize: number;
  version: number;
  generatedAt: Date;
};

/** The latest persisted calibration report for a role version, or null. Tenant-scoped. */
export async function getLatestCalibration(
  orgId: string,
  roleProfileId: string
): Promise<StoredCalibration | null> {
  const row = await prisma.profileCalibration.findFirst({
    where: { orgId, roleProfileId },
    orderBy: { generatedAt: "desc" },
    select: { metrics: true, sampleSize: true, version: true, generatedAt: true },
  });
  if (!row) return null;
  return {
    report: row.metrics as unknown as CalibrationReport,
    sampleSize: row.sampleSize,
    version: row.version,
    generatedAt: row.generatedAt,
  };
}

// ---- Adverse-impact monitor (org-wide selection rates) ----

export type AdverseImpactView = {
  rows: SelectionRateRow[];
  /** Candidates included in the computation (≤ MAX_ADVERSE_RESULTS). */
  total: number;
  /** True decided-result count in the org. */
  dbTotal: number;
  /** True when the read was truncated (total < dbTotal) — the UI must say so. */
  capped: boolean;
};

/**
 * Org-wide selection-rate / adverse-impact monitor (ARCHITECTURE §11). Groups every
 * decided result by role family and reports advance + band-pass rates with the
 * 4/5ths-rule flag. HONEST LIMIT (stated in the UI): protected-class demographics
 * are NOT collected by design (PDPL minimization), so the only grouping is
 * structural — this is a selection-rate monitor, not an EEO adverse-impact study.
 */
export async function getAdverseImpact(orgId: string): Promise<AdverseImpactView> {
  // Decided results only (a decision is the selection event). Tenant-scoped, live
  // sittings only. Capped + counted so a truncated read is surfaced honestly (the
  // UI shows "X of Y") rather than presenting partial rates as definitive (H-2).
  const where: Prisma.ResultWhereInput = {
    orgId,
    assessment: { deletedAt: null },
    decision: { not: null },
  };
  const [rows, dbTotal] = await Promise.all([
    prisma.result.findMany({
      where,
      take: MAX_ADVERSE_RESULTS,
      select: {
        decision: true,
        competencyScores: true,
        assessment: {
          select: {
            invitation: { select: { roleProfile: { select: { roleFamily: { select: { name: true } } } } } },
          },
        },
      },
    }),
    prisma.result.count({ where }),
  ]);

  const inputs = rows.map((r) => {
    const comps = r.competencyScores as unknown as CompetencyScoreRow[];
    return {
      group: r.assessment.invitation.roleProfile.roleFamily.name,
      selected: r.decision === "ADVANCE",
      // "passed" = met every competency band (the documented overall bar).
      passed: comps.length > 0 && comps.every((c) => c.band === "PASS"),
    };
  });

  return {
    rows: selectionRates(inputs),
    total: inputs.length,
    dbTotal,
    capped: inputs.length < dbTotal,
  };
}

export { MIN_OUTCOMES_FOR_REPORT };
