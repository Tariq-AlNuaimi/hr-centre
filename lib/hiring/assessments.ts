import type { HiringStage } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { hasGroup } from "@/lib/rbac/grants";
import { isHiringAdmin, type HiringActor } from "./access";
import {
  assessmentConfigSchema,
  blocksAdvance,
  computeValidUntil,
  DEFAULT_ASSESSMENT_CONFIG,
  isThresholdLocked,
  reuseDecision,
  type AssessmentConfig,
} from "./assessment-rules";
import { applyStageChange } from "./candidate-stage";
import { HiringRuleError } from "./http";
import { readSetting, writeSetting } from "./settings";

/**
 * Aptitude assessments (Interview Hub `assessments.ts` + the position and
 * settings routes). The provider is external: this records who was invited,
 * reminded and what came back — it sends nothing (Interview Hub sent no email
 * either, ADR-059). D3: the result can now actually be RECORDED here.
 */

const CAP = 200;
const AT_ASSESSMENT = ["SHORTLISTED", "ASSESSMENT"] as const;

export async function loadAssessmentConfig(): Promise<AssessmentConfig> {
  const parsed = assessmentConfigSchema.safeParse(await readSetting("assessment.config"));
  return parsed.success ? parsed.data : DEFAULT_ASSESSMENT_CONFIG;
}

export function completedResultCount() {
  return prisma.hiringAssessment.count({ where: { status: "COMPLETED" } });
}

/** The policy is org-wide, so editing it needs an org-wide HR Manager (or admin). */
export function mayEditPolicy(actor: HiringActor) {
  return isHiringAdmin(actor) || hasGroup(actor.grants, "hiring.hrManager");
}

export async function policyView(actor: HiringActor) {
  const [config, results] = await Promise.all([loadAssessmentConfig(), completedResultCount()]);
  return {
    ...config,
    thresholdLocked: isThresholdLocked(results),
    resultCount: results,
    mayEditPolicy: mayEditPolicy(actor),
  };
}

export async function savePolicy(actor: HiringActor, next: AssessmentConfig) {
  if (!mayEditPolicy(actor)) {
    throw new HiringRuleError("Only an HR Manager can change the assessment policy.", 403);
  }
  await writeSetting("assessment.config", next);
}

export async function listAssessments(requisitionId: string) {
  const rows = await prisma.hiringCandidate.findMany({
    where: { requisitionId, stage: { in: [...AT_ASSESSMENT] }, erasedAt: null },
    select: { id: true, name: true, stage: true, assessment: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows.map((c) => ({
    candidateId: c.id,
    candidateName: c.name,
    stage: c.stage,
    status: c.assessment?.status ?? "NOT_SENT",
    invitedAt: c.assessment?.invitedAt ?? null,
    score: c.assessment?.score ?? null,
    percentile: c.assessment?.percentile ?? null,
    interviewFocus: c.assessment?.interviewFocus ?? null,
    validUntil: c.assessment?.validUntil ?? null,
    completedAt: c.assessment?.completedAt ?? null,
    dueAt: c.assessment?.dueAt ?? null,
    remindersSent: c.assessment?.remindersSent ?? 0,
  }));
}

type Scoped = {
  id: string;
  stage: HiringStage;
  requisitionId: string | null;
  preferredAt: Date | null;
};

async function scopedCandidates(requisitionId: string, ids: string[]): Promise<Scoped[]> {
  const rows = await prisma.hiringCandidate.findMany({
    where: { id: { in: ids }, requisitionId },
    select: { id: true, stage: true, requisitionId: true, preferredAt: true },
    take: CAP,
  });
  if (rows.length === 0)
    throw new HiringRuleError("No candidates on this requisition matched.", 422);
  return rows;
}

export async function invite(
  actor: HiringActor,
  requisitionId: string,
  ids: string[],
  dueAt: Date | null,
) {
  if (dueAt && dueAt.getTime() <= Date.now()) {
    throw new HiringRuleError("The completion deadline must be in the future.", 422);
  }
  const [rows, config] = await Promise.all([
    scopedCandidates(requisitionId, ids),
    loadAssessmentConfig(),
  ]);
  const existing = await prisma.hiringAssessment.findMany({
    where: { candidateId: { in: rows.map((r) => r.id) } },
    take: CAP,
  });
  const byCandidate = new Map(existing.map((a) => [a.candidateId, a]));
  const now = new Date();
  const counts = { invited: 0, reused: 0, pending: 0 };
  for (const c of rows) {
    const prior = byCandidate.get(c.id) ?? null;
    const decision = reuseDecision(prior, now, config.validityMonths);
    if (decision.action === "already-pending") {
      counts.pending += 1;
      continue;
    }
    if (decision.action === "invite") {
      const fresh = { status: "INVITED" as const, provider: config.name, invitedAt: now, dueAt };
      if (prior) {
        await prisma.hiringAssessment.update({
          where: { id: prior.id },
          data: {
            ...fresh,
            score: null,
            percentile: null,
            completedAt: null,
            validUntil: null,
            interviewFocus: null,
            remindersSent: 0,
            lastRemindedAt: null,
          },
          select: { id: true },
        });
      } else {
        await prisma.hiringAssessment.create({
          data: { candidateId: c.id, ...fresh },
          select: { id: true },
        });
      }
      counts.invited += 1;
    } else counts.reused += 1;
    if (c.stage !== "ASSESSMENT") {
      await applyStageChange({
        cand: c,
        toStage: "ASSESSMENT",
        movedById: actor.userId,
        reason: decision.reason,
      });
    }
  }
  return counts;
}

export async function remind(requisitionId: string, ids: string[]) {
  const rows = await scopedCandidates(requisitionId, ids);
  const pending = await prisma.hiringAssessment.findMany({
    where: {
      candidateId: { in: rows.map((r) => r.id) },
      status: { in: ["INVITED", "IN_PROGRESS"] },
    },
    select: { id: true, remindersSent: true },
    take: CAP,
  });
  for (const a of pending) {
    await prisma.hiringAssessment.update({
      where: { id: a.id },
      data: { remindersSent: a.remindersSent + 1, lastRemindedAt: new Date() },
      select: { id: true },
    });
  }
  return { reminded: pending.length };
}

/** Completed + not held by a hard cut-off → First interview; everyone else is listed with why. */
export async function advance(actor: HiringActor, requisitionId: string, ids: string[]) {
  const [rows, config] = await Promise.all([
    scopedCandidates(requisitionId, ids),
    loadAssessmentConfig(),
  ]);
  const results = await prisma.hiringAssessment.findMany({
    where: { candidateId: { in: rows.map((r) => r.id) }, status: "COMPLETED" },
    select: { candidateId: true, score: true },
    take: CAP,
  });
  const score = new Map(results.map((r) => [r.candidateId, r.score]));
  const held: { candidateId: string; reason: string }[] = [];
  let advanced = 0;
  for (const c of rows) {
    if (!score.has(c.id)) {
      held.push({
        candidateId: c.id,
        reason: "No completed assessment on record — advancing needs a recorded reason.",
      });
    } else if (blocksAdvance(score.get(c.id), config)) {
      held.push({
        candidateId: c.id,
        reason: `Score ${score.get(c.id)} is below the ${config.passThreshold} cut-off configured for this role.`,
      });
    } else if (c.stage === "ASSESSMENT") {
      await applyStageChange({
        cand: c,
        toStage: "FIRST_INTERVIEW",
        movedById: actor.userId,
        reason: "Aptitude assessment complete (step 6).",
      });
      advanced += 1;
    }
  }
  return { advanced, held };
}

/** D3 — record the result the provider returned. */
export async function recordResult(
  requisitionId: string,
  body: {
    candidateId: string;
    score: number;
    percentile?: number | null;
    interviewFocus: string | null;
  },
) {
  await scopedCandidates(requisitionId, [body.candidateId]);
  const existing = await prisma.hiringAssessment.findUnique({
    where: { candidateId: body.candidateId },
  });
  if (!existing) throw new HiringRuleError("Send the assessment before recording a result.", 422);
  const config = await loadAssessmentConfig();
  const now = new Date();
  await prisma.hiringAssessment.update({
    where: { id: existing.id },
    data: {
      status: "COMPLETED",
      score: body.score,
      percentile: body.percentile ?? null,
      interviewFocus: body.interviewFocus,
      completedAt: now,
      validUntil: computeValidUntil(now, config.validityMonths),
    },
    select: { id: true },
  });
}
