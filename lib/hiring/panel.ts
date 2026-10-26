import type { HiringVote, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import type { HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { canReveal, resolveBriefForRound } from "./interview-rules";
import { panelAiMode } from "./interview-views";
import { loadInterview, loadRoundPlan, type LoadedInterview } from "./interviews";
import { peopleById } from "./people";

/**
 * The panelist's side (Interview Hub `/api/panel/*`): my panels, the brief,
 * my scorecard, the post-submit comparison and a logged revision. Every call
 * is for an interview the actor is ON — loading it any other way is 404.
 */

const QUESTION_CAP = 8;

/** The interview, only if the actor sits on its panel (and still has hiring access). */
export async function loadMyInterview(actor: HiringActor, id: string): Promise<LoadedInterview> {
  const l = await loadInterview(actor, id);
  const on = l
    ? await prisma.hiringInterviewPanelist.count({
        where: { interviewId: id, userId: actor.userId },
      })
    : 0;
  if (!l || on === 0) throw new HiringRuleError("You are not a panelist on this interview.", 404);
  return l;
}

export async function myPanels(actor: HiringActor) {
  const rows = await prisma.hiringInterview.findMany({
    where: { panelists: { some: { userId: actor.userId } } },
    orderBy: { scheduledDate: "asc" },
    take: 200,
    select: {
      id: true,
      round: true,
      status: true,
      scheduledDate: true,
      location: true,
      meetingLink: true,
      requisitionId: true,
      candidate: { select: { id: true, name: true } },
      requisition: { select: { id: true, title: true, competencies: true } },
      scorecards: { where: { panelistId: actor.userId }, select: { submitted: true, vote: true } },
    },
  });
  const out = rows.map((iv) => {
    const mine = iv.scorecards[0];
    return {
      id: iv.id,
      round: iv.round,
      status: iv.status,
      scheduledDate: iv.scheduledDate,
      location: iv.location ?? iv.meetingLink ?? null,
      candidate: iv.candidate,
      requisition: { id: iv.requisition.id, title: iv.requisition.title },
      competencies: iv.requisition.competencies,
      submitted: mine?.submitted === true,
      myVote: mine?.submitted ? mine.vote : null,
    };
  });
  return { upcoming: out.filter((r) => !r.submitted), submitted: out.filter((r) => r.submitted) };
}

type Profile = { summary?: unknown; experience?: unknown; skills?: unknown };

/**
 * The brief. D7: employer, experience and skills only — never nationality,
 * contact details or the raw extracted profile, which Interview Hub returned.
 * Competencies are the round's (from the interview brief), else the
 * requisition's; questions come from the question bank for those competencies.
 */
export async function brief(actor: HiringActor, l: LoadedInterview) {
  const [cand, plan, card, mode] = await Promise.all([
    prisma.hiringCandidate.findUnique({
      where: { id: l.iv.candidateId },
      select: { currentEmployer: true, profileData: true },
    }),
    loadRoundPlan(l.iv.requisitionId),
    prisma.hiringScorecard.findUnique({
      where: { interviewId_panelistId: { interviewId: l.iv.id, panelistId: actor.userId } },
      select: { submitted: true },
    }),
    panelAiMode(),
  ]);
  const entry = resolveBriefForRound(plan, l.iv.round);
  const req = await prisma.hiringRequisition.findUnique({
    where: { id: l.iv.requisitionId },
    select: { competencies: true },
  });
  const competencies = entry.competencies.length ? entry.competencies : (req?.competencies ?? []);
  const [questions, anchors] = await Promise.all([
    prisma.hiringQuestion.findMany({
      where: {
        OR: [{ requisitionId: l.iv.requisitionId }, { competency: { in: competencies } }],
      },
      orderBy: [{ qualityScore: "desc" }, { createdAt: "asc" }],
      take: QUESTION_CAP,
      select: { id: true, questionText: true, competency: true, category: true },
    }),
    prisma.hiringCompetency.findMany({
      where: { name: { in: competencies } },
      select: { name: true, anchors: true },
      take: 50,
    }),
  ]);
  const p = (cand?.profileData ?? {}) as Profile;
  return {
    interview: {
      id: l.iv.id,
      round: l.iv.round,
      roundOrdinal: entry.ordinal,
      scheduledDate: l.iv.scheduledDate,
      location: l.iv.location ?? l.iv.meetingLink ?? null,
    },
    candidate: {
      id: l.iv.candidate.id,
      name: l.iv.candidate.name,
      currentEmployer: cand?.currentEmployer ?? null,
      summary: typeof p.summary === "string" ? p.summary : null,
      experience: Array.isArray(p.experience) ? sanitizeExperience(p.experience) : [],
      skills: Array.isArray(p.skills) ? p.skills.map(String).slice(0, 40) : [],
    },
    requisition: { id: l.iv.requisition.id, title: l.iv.requisition.title },
    competencies,
    anchors: Object.fromEntries(anchors.map((a) => [a.name, a.anchors])),
    questions,
    panelAiMode: mode,
    alreadySubmitted: card?.submitted === true,
  };
}

/** Only the four fields a panelist needs from each role. */
function sanitizeExperience(raw: unknown[]) {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return raw.slice(0, 20).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      title: str(o.title) ?? str(o.role),
      company: str(o.company) ?? str(o.employer),
      period: [str(o.startDate), str(o.endDate)].filter(Boolean).join(" – ") || str(o.period),
      description: str(o.description),
    };
  });
}

const CARD_SELECT = {
  id: true,
  scores: true,
  strengths: true,
  concerns: true,
  notes: true,
  vote: true,
  submitted: true,
  submittedAt: true,
} as const;

export function myScorecard(actor: HiringActor, interviewId: string) {
  return prisma.hiringScorecard.findUnique({
    where: { interviewId_panelistId: { interviewId, panelistId: actor.userId } },
    select: CARD_SELECT,
  });
}

export type ScoreBody = {
  scores?: Record<string, number>;
  strengths?: string;
  concerns?: string;
  notes?: string;
  vote?: HiringVote;
  submit: boolean;
};

export async function saveScorecard(actor: HiringActor, l: LoadedInterview, body: ScoreBody) {
  if (body.submit && !body.vote)
    throw new HiringRuleError("Cast your hire vote before submitting.", 400);
  if (l.iv.candidate.referredById === actor.userId) {
    throw new HiringRuleError(
      "You referred this candidate, so you can't also assess them — a referral is a conflict of interest and needs a different assessor.",
      403,
    );
  }
  const existing = await myScorecard(actor, l.iv.id);
  if (existing?.submitted) {
    throw new HiringRuleError(
      "Your scorecard is already submitted. Use revise (with a reason) to change it.",
      409,
    );
  }
  // A field the body leaves out keeps its draft value, so a notes-only autosave never wipes scores.
  const keep = <T>(next: T | undefined, prev: T | null | undefined) =>
    next === undefined ? (prev ?? null) : next || null;
  const data = {
    scores: (body.scores ?? existing?.scores ?? {}) as Prisma.InputJsonValue,
    strengths: keep(body.strengths, existing?.strengths),
    concerns: keep(body.concerns, existing?.concerns),
    notes: keep(body.notes, existing?.notes),
    // A draft carries a placeholder vote (the column is required); it counts only once submitted.
    vote: body.vote ?? existing?.vote ?? "HIRE",
    submitted: body.submit,
    submittedAt: body.submit ? new Date() : null,
  };
  return existing
    ? prisma.hiringScorecard.update({ where: { id: existing.id }, data, select: CARD_SELECT })
    : prisma.hiringScorecard.create({
        data: {
          interviewId: l.iv.id,
          candidateId: l.iv.candidateId,
          panelistId: actor.userId,
          ...data,
        },
        select: CARD_SELECT,
      });
}

/** After the reveal, a changed scorecard is kept — with the panelist's reason on the audit trail. */
export async function reviseScorecard(
  actor: HiringActor,
  l: LoadedInterview,
  body: ScoreBody & { scores: Record<string, number>; vote: HiringVote; reason: string },
) {
  const existing = await myScorecard(actor, l.iv.id);
  if (!existing) throw new HiringRuleError("Scorecard not found.", 404);
  if (!existing.submitted)
    throw new HiringRuleError("Nothing to revise — submit your scorecard first.", 409);
  if (!canReveal(await panelAiMode(), true)) {
    throw new HiringRuleError("Revision is only available after the comparison is unlocked.", 409);
  }
  const updated = await prisma.hiringScorecard.update({
    where: { id: existing.id },
    data: {
      scores: body.scores as Prisma.InputJsonValue,
      strengths: body.strengths || null,
      concerns: body.concerns || null,
      notes: body.notes || null,
      vote: body.vote,
    },
    select: CARD_SELECT,
  });
  await recordAudit(prisma, {
    entityType: "HiringScorecard",
    entityId: existing.id,
    action: "UPDATE",
    before: { vote: existing.vote, scores: existing.scores },
    after: {
      vote: updated.vote,
      scores: updated.scores,
      panelReviseReason: body.reason,
      revisedAfterReveal: true,
    },
  });
  return updated;
}

/**
 * The post-submit comparison. D14: the AI view is the interview's own
 * transcript analysis (the only judgement kind still produced); peers are
 * other panelists' SUBMITTED scorecards.
 */
export async function compare(actor: HiringActor, l: LoadedInterview) {
  const mode = await panelAiMode();
  const mine = await myScorecard(actor, l.iv.id);
  if (!canReveal(mode, mine?.submitted === true)) {
    return { locked: true as const, mode, mine };
  }
  const [peers, transcript] = await Promise.all([
    prisma.hiringScorecard.findMany({
      where: { interviewId: l.iv.id, submitted: true, panelistId: { not: actor.userId } },
      select: { panelistId: true, vote: true, scores: true, strengths: true, concerns: true },
      take: 50,
    }),
    prisma.hiringAiInsight.findFirst({
      where: { entityType: "Interview", entityId: l.iv.id, kind: "transcript" },
      orderBy: { createdAt: "desc" },
      select: { output: true, model: true, createdAt: true },
    }),
  ]);
  const names = await peopleById(peers.map((p) => p.panelistId));
  return {
    locked: false as const,
    mode,
    mine,
    peers: peers.map((p) => ({ ...p, name: names.get(p.panelistId)?.name ?? "—" })),
    ai: transcript,
  };
}
