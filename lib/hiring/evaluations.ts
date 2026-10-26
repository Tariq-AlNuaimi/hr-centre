import type { HiringVote, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { isPanelistOn, loadInterview } from "./interviews";
import { peopleById, personOrNull } from "./people";
import { requisitionScopeWhere, requisitionSubject } from "./scope";

/**
 * Scorecards as HR sees them (Interview Hub `/evaluations`): the list, one
 * scorecard, and recording one on a panelist's behalf. The candidate always
 * comes from the interview, and the panelist must be ON that panel — a
 * scorecard from anyone else would never be counted in the comparison.
 */

export type EvaluationListQuery = {
  page: number;
  pageSize: number;
  vote?: HiringVote;
  sort: "vote" | "createdAt";
  order: "asc" | "desc";
};

export async function listEvaluations(actor: HiringActor, q: EvaluationListQuery) {
  const scope = await requisitionScopeWhere(actor, "hiring.manage");
  if (scope === null) return { data: [], total: 0 };
  const where: Prisma.HiringScorecardWhereInput = {
    ...(Object.keys(scope).length ? { interview: { requisition: scope } } : {}),
    ...(q.vote ? { vote: q.vote, submitted: true } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.hiringScorecard.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: [{ [q.sort]: q.order }, { id: q.order }],
      select: {
        id: true,
        vote: true,
        submitted: true,
        submittedAt: true,
        createdAt: true,
        panelistId: true,
        candidate: { select: { id: true, name: true } },
        interview: {
          select: {
            id: true,
            round: true,
            scheduledDate: true,
            requisition: { select: { title: true } },
          },
        },
      },
    }),
    prisma.hiringScorecard.count({ where }),
  ]);
  const people = await peopleById(rows.map((r) => r.panelistId));
  return {
    data: rows.map((r) => ({
      ...r,
      vote: r.submitted ? r.vote : null,
      panelist: personOrNull(people, r.panelistId),
    })),
    total,
  };
}

/** One scorecard HR may manage; null = 404. */
export async function loadEvaluation(actor: HiringActor, id: string) {
  const card = await prisma.hiringScorecard.findUnique({
    where: { id },
    include: {
      candidate: { select: { id: true, name: true } },
      interview: {
        select: {
          id: true,
          round: true,
          scheduledDate: true,
          requisition: {
            select: {
              id: true,
              title: true,
              entityId: true,
              departmentId: true,
              competencies: true,
            },
          },
        },
      },
    },
  });
  if (!card) return null;
  const subject = await requisitionSubject(card.interview.requisition);
  if (!can(actor, "hiring.manage", subject)) return null;
  const people = await peopleById([card.panelistId]);
  return { card, panelist: personOrNull(people, card.panelistId) };
}

export type EvaluationBody = {
  vote: HiringVote;
  scores: Record<string, number>;
  strengths?: string | null;
  concerns?: string | null;
  notes?: string | null;
  submitted?: boolean;
};

async function assertAssessor(candidateId: string, panelistId: string) {
  const c = await prisma.hiringCandidate.findUnique({
    where: { id: candidateId },
    select: { referredById: true },
  });
  if (c?.referredById === panelistId) {
    throw new HiringRuleError(
      "That panelist referred this candidate, so they can't also assess them — a referral is a conflict of interest.",
      403,
    );
  }
}

export async function createEvaluation(
  actor: HiringActor,
  body: EvaluationBody & { interviewId: string; panelistId: string },
) {
  const l = await loadInterview(actor, body.interviewId, "hiring.manage");
  if (!l) throw new HiringRuleError("That interview was not found.", 404);
  if (!(await isPanelistOn(l.iv.id, body.panelistId))) {
    throw new HiringRuleError(
      "That person is not on this interview's panel. Add them to the panel first.",
      422,
    );
  }
  await assertAssessor(l.iv.candidateId, body.panelistId);
  return prisma.hiringScorecard.create({
    data: {
      interviewId: l.iv.id,
      candidateId: l.iv.candidateId,
      panelistId: body.panelistId,
      vote: body.vote,
      scores: body.scores,
      strengths: body.strengths || null,
      concerns: body.concerns || null,
      notes: body.notes || null,
      submitted: body.submitted ?? false,
      submittedAt: body.submitted ? new Date() : null,
    },
    select: { id: true },
  });
}

export async function updateEvaluation(
  card: {
    id: string;
    candidateId: string;
    panelistId: string;
    submitted: boolean;
    submittedAt: Date | null;
  },
  body: Partial<EvaluationBody>,
) {
  await assertAssessor(card.candidateId, card.panelistId);
  await prisma.hiringScorecard.update({
    where: { id: card.id },
    data: {
      ...(body.vote ? { vote: body.vote } : {}),
      ...(body.scores ? { scores: body.scores } : {}),
      ...(body.strengths !== undefined ? { strengths: body.strengths || null } : {}),
      ...(body.concerns !== undefined ? { concerns: body.concerns || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.submitted !== undefined
        ? {
            submitted: body.submitted,
            submittedAt: body.submitted ? (card.submittedAt ?? new Date()) : null,
          }
        : {}),
    },
    select: { id: true },
  });
}
