import type { HiringStage } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { applyStageChange, releaseHoldsForRequisition } from "./candidate-stage";
import { HiringRuleError } from "./http";
import type { RoundPlanEntry } from "./interview-rules";
import { loadRoundPlan } from "./interviews";
import { peopleById } from "./people";
import type { LoadedRequisition } from "./requisitions";
import {
  aggregateVerdict,
  competencyAverages,
  coverageOf,
  describeRounds,
  initialsOf,
  prepareScorecard,
  weightedOverall,
  type PreparedScorecard,
} from "./scorecard-math";
import { mayCrossGates } from "./stage-gates";
import { LINEAR_STAGES, isPastFirstInterview, stageRank } from "./stage-rules";

/**
 * The evaluation comparison and the decision (step 8) — Interview Hub
 * `candidate-comparison.ts` + `/positions/[id]/comparison`. Finalists are the
 * candidates at or past the first interview; every panel seat is a scorecard
 * slot, submitted or not, so the coverage is honest about who has not reported.
 */

export const FINALIST_STAGES: readonly HiringStage[] = LINEAR_STAGES.filter(isPastFirstInterview);
const MAX_FINALISTS = 24;
const MAX_INTERVIEWS = 200;

/**
 * The matrix rows: what the rounds actually assess. A round without its own
 * competencies falls back to the requisition's (as its brief does), so those
 * are included only then — Interview Hub used the requisition's list alone,
 * which left every round-specific score off the matrix.
 */
export function matrixCompetencies(
  plan: readonly RoundPlanEntry[],
  requisition: readonly string[],
): string[] {
  const own = plan.flatMap((e) => e.competencies);
  const fallsBack = plan.length === 0 || plan.some((e) => e.competencies.length === 0);
  return [...new Set([...own, ...(fallsBack ? requisition : [])])];
}

type Slot = PreparedScorecard & {
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
};

export async function loadComparison(l: LoadedRequisition) {
  const req = l.req;
  const finalists = await prisma.hiringCandidate.findMany({
    where: { requisitionId: req.id, stage: { in: [...FINALIST_STAGES] }, erasedAt: null },
    orderBy: [{ preferredAt: "desc" }, { createdAt: "asc" }],
    take: MAX_FINALISTS,
    select: {
      id: true,
      name: true,
      stage: true,
      preferredAt: true,
      preferredById: true,
      preferredNote: true,
      preferredOutstandingScorecards: true,
    },
  });
  const interviews = finalists.length
    ? await prisma.hiringInterview.findMany({
        where: { requisitionId: req.id, candidateId: { in: finalists.map((c) => c.id) } },
        orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
        take: MAX_INTERVIEWS,
        select: {
          id: true,
          candidateId: true,
          panelists: { select: { userId: true } },
          scorecards: {
            select: {
              panelistId: true,
              submitted: true,
              vote: true,
              scores: true,
              strengths: true,
              concerns: true,
              notes: true,
            },
          },
        },
      })
    : [];
  const competencies = matrixCompetencies(await loadRoundPlan(req.id), req.competencies);
  const people = await peopleById([
    ...interviews.flatMap((iv) => iv.panelists.map((p) => p.userId)),
    ...finalists.map((f) => f.preferredById),
  ]);
  const nameOf = (id: string) => people.get(id)?.name ?? "Unnamed panelist";

  const roundOf = new Map<string, number>();
  const roundsByCandidate = new Map<string, number>();
  for (const iv of interviews) {
    const n = (roundsByCandidate.get(iv.candidateId) ?? 0) + 1;
    roundsByCandidate.set(iv.candidateId, n);
    roundOf.set(iv.id, n);
  }
  const slots = new Map<string, Slot[]>();
  for (const iv of interviews) {
    const byPanelist = new Map(iv.scorecards.map((s) => [s.panelistId, s]));
    for (const p of iv.panelists) {
      const ev = byPanelist.get(p.userId);
      const list = slots.get(iv.candidateId) ?? [];
      list.push({
        ...prepareScorecard({
          candidateId: iv.candidateId,
          interviewId: iv.id,
          panelistId: p.userId,
          round: roundOf.get(iv.id) ?? 0,
          submitted: ev?.submitted === true,
          vote: ev?.vote ?? null,
          scores: ev?.scores ?? null,
        }),
        strengths: ev?.strengths ?? null,
        concerns: ev?.concerns ?? null,
        notes: ev?.notes ?? null,
      });
      slots.set(iv.candidateId, list);
    }
  }

  const views = finalists.map((c) => {
    const s = slots.get(c.id) ?? [];
    const averages = competencyAverages(competencies, s);
    return {
      candidateId: c.id,
      name: c.name,
      initials: initialsOf(c.name),
      stage: c.stage,
      preferred: c.preferredAt !== null,
      preferredAt: c.preferredAt,
      preferredByName: c.preferredById ? (people.get(c.preferredById)?.name ?? null) : null,
      preferredNote: c.preferredNote,
      preferredOutstandingScorecards: c.preferredOutstandingScorecards,
      averages,
      weighted: weightedOverall(averages),
      verdict: aggregateVerdict(s),
      coverage: coverageOf(s, nameOf),
      feedback: feedbackOf(s, nameOf, req.hiringManagerId, roundsByCandidate.get(c.id) ?? 0),
    };
  });
  const coverage = coverageOf([...slots.values()].flat(), nameOf);
  return {
    requisition: { id: req.id, title: req.title, competencies },
    finalists: views,
    coverage,
    preferredCandidateId: views.find((v) => v.preferred)?.candidateId ?? null,
  };
}

/** One entry per panelist: their latest submitted vote and the first written comment. */
function feedbackOf(
  slots: readonly Slot[],
  nameOf: (id: string) => string,
  hmId: string,
  totalRounds: number,
) {
  const byPanelist = new Map<string, Slot[]>();
  for (const s of slots) byPanelist.set(s.panelistId, [...(byPanelist.get(s.panelistId) ?? []), s]);
  return [...byPanelist.entries()]
    .map(([panelistId, group]) => {
      const done = group.filter((g) => g.submitted).sort((a, b) => b.round - a.round);
      const latest = done[0] ?? null;
      const source = latest
        ? (["notes", "strengths", "concerns"] as const).find((k) => latest[k]?.trim())
        : undefined;
      const name = nameOf(panelistId);
      return {
        panelistId,
        name,
        initials: initialsOf(name),
        isHiringManager: panelistId === hmId,
        rounds: describeRounds(
          group.map((g) => g.round),
          totalRounds,
        ),
        vote: latest?.hireVote ?? null,
        comment: source && latest ? latest[source]!.trim() : null,
        commentSource: source ?? null,
        submittedCount: done.length,
        slotCount: group.length,
      };
    })
    .sort(
      (a, b) => Number(a.vote === null) - Number(b.vote === null) || a.name.localeCompare(b.name),
    );
}

async function loadFinalist(l: LoadedRequisition, candidateId: string) {
  const c = await prisma.hiringCandidate.findFirst({
    where: { id: candidateId, requisitionId: l.req.id },
    select: {
      id: true,
      name: true,
      stage: true,
      preferredAt: true,
      packageStatus: true,
      requisitionId: true,
    },
  });
  if (!c) throw new HiringRuleError("That candidate is not on this requisition.", 422);
  if (!FINALIST_STAGES.includes(c.stage)) {
    throw new HiringRuleError(
      `${c.name} has not reached the interview stage, so they are not a finalist on this comparison.`,
      422,
    );
  }
  return c;
}

/**
 * Select the preferred candidate: a ≥20-character decision note, no other
 * preferred candidate, and the move to Decision pending must not skip a gate.
 * (Interview Hub marked the candidate preferred BEFORE checking the gate, so a
 * refused move left them half-selected.) The package request opens here.
 */
export async function selectPreferred(
  actor: HiringActor,
  l: LoadedRequisition,
  candidateId: string,
  note: string,
) {
  const c = await loadFinalist(l, candidateId);
  const other = await prisma.hiringCandidate.findFirst({
    where: {
      requisitionId: l.req.id,
      id: { not: c.id },
      preferredAt: { not: null },
      stage: { notIn: ["REJECTED", "WITHDRAWN"] },
    },
    select: { name: true },
  });
  if (other) {
    throw new HiringRuleError(
      `${other.name} is already the preferred candidate on this requisition. Clear that selection first.`,
      422,
    );
  }
  const needsMove = stageRank(c.stage) < stageRank("DECISION_PENDING");
  if (needsMove && mayCrossGates(c.stage, "DECISION_PENDING")) {
    throw new HiringRuleError(
      "This candidate has not cleared every required step yet. Move them on from their candidate record, where an exception can be recorded.",
      422,
    );
  }
  const view = await loadComparison(l);
  const outstanding = view.finalists.find((f) => f.candidateId === c.id)?.coverage.outstanding ?? 0;
  await prisma.hiringCandidate.update({
    where: { id: c.id },
    data: {
      preferredAt: new Date(),
      preferredById: actor.userId,
      preferredNote: note,
      preferredOutstandingScorecards: outstanding,
      ...(c.packageStatus === "NOT_REQUESTED"
        ? { packageStatus: "REQUESTED", packageRequestedAt: new Date() }
        : {}),
    },
    select: { id: true },
  });
  if (needsMove) {
    await applyStageChange({
      cand: { ...c, preferredAt: null },
      toStage: "DECISION_PENDING",
      movedById: actor.userId,
      reason: `Selected as the preferred candidate (step 8). ${note}`,
    });
  }
  return {
    preferred: c.id,
    outstandingScorecards: outstanding,
    packageRequested: c.packageStatus === "NOT_REQUESTED",
  };
}

export async function rejectFinalist(
  actor: HiringActor,
  l: LoadedRequisition,
  candidateId: string,
  reason: string,
) {
  const c = await loadFinalist(l, candidateId);
  if (c.preferredAt) {
    throw new HiringRuleError(
      `${c.name} is the preferred candidate. Clear the selection before rejecting them.`,
      422,
    );
  }
  await applyStageChange({ cand: c, toStage: "REJECTED", movedById: actor.userId, reason });
  return { rejected: c.id };
}

/** Reverse a selection (Interview Hub pointed to a reversal that did not exist). Held notices are released. */
export async function clearPreferred(l: LoadedRequisition, candidateId: string) {
  const c = await loadFinalist(l, candidateId);
  if (!c.preferredAt) throw new HiringRuleError(`${c.name} is not the preferred candidate.`, 422);
  await prisma.hiringCandidate.update({
    where: { id: c.id },
    data: {
      preferredAt: null,
      preferredById: null,
      preferredNote: null,
      preferredOutstandingScorecards: null,
    },
    select: { id: true },
  });
  await releaseHoldsForRequisition(l.req.id, c.id);
  return { cleared: c.id };
}
