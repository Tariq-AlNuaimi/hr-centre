import type { HiringInterviewStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type HiringActor } from "./access";
import { asPanelAiMode, canReveal } from "./interview-rules";
import { interviewReadWhere, withPanelAndRound, type LoadedInterview } from "./interviews";
import { readSetting } from "./settings";

/** Interview reads: the list, the schedule of a requisition, one interview. */

const LIST_SELECT = {
  id: true,
  requisitionId: true,
  round: true,
  status: true,
  scheduledDate: true,
  location: true,
  meetingLink: true,
  createdAt: true,
  requisition: { select: { id: true, title: true } },
  candidate: { select: { id: true, name: true } },
} as const;

export type InterviewListQuery = {
  page: number;
  pageSize: number;
  status?: HiringInterviewStatus;
  search?: string;
  requisitionId?: string;
  sort: "scheduledDate" | "status" | "round" | "createdAt";
  order: "asc" | "desc";
};

export async function listInterviews(actor: HiringActor, q: InterviewListQuery) {
  const scope = await interviewReadWhere(actor);
  if (scope === null) return { data: [], total: 0 };
  const where: Prisma.HiringInterviewWhereInput = {
    AND: [
      scope,
      q.status ? { status: q.status } : {},
      q.requisitionId ? { requisitionId: q.requisitionId } : {},
      // Interview Hub's search box sent `search` to an API that ignored it.
      q.search ? { candidate: { name: { contains: q.search, mode: "insensitive" } } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.hiringInterview.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: [{ [q.sort]: q.order }, { id: q.order }],
      select: LIST_SELECT,
    }),
    prisma.hiringInterview.count({ where }),
  ]);
  return { data: await withPanelAndRound(rows), total };
}

/** Every interview in scope for an .ics feed (≤ 2,000). */
export async function calendarRows(
  actor: HiringActor,
  filter: { requisitionId?: string; status?: HiringInterviewStatus },
) {
  const scope = await interviewReadWhere(actor);
  if (scope === null) return [];
  const rows = await prisma.hiringInterview.findMany({
    where: {
      AND: [
        scope,
        filter.requisitionId ? { requisitionId: filter.requisitionId } : {},
        filter.status ? { status: filter.status } : {},
      ],
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    take: 2000,
    select: LIST_SELECT,
  });
  return withPanelAndRound(rows);
}

export async function panelAiMode() {
  return asPanelAiMode(await readSetting("panel.aiMode"));
}

/**
 * One interview. Notes, the AI analysis and the recording are JUDGMENTS: a
 * panel-only reader gets them only once the panel mode reveals them (after
 * their own scorecard in blind mode), so nothing anchors their first read.
 */
export async function interviewDetail(actor: HiringActor, l: LoadedInterview) {
  const iv = l.iv;
  const manage = can(actor, "hiring.manage", l.subject);
  const [[decorated], cards] = await Promise.all([
    withPanelAndRound([iv]),
    prisma.hiringScorecard.findMany({
      where: { interviewId: iv.id },
      select: { panelistId: true, submitted: true },
      take: 50,
    }),
  ]);
  const mine = cards.find((c) => c.panelistId === actor.userId);
  const reveal = manage || canReveal(await panelAiMode(), mine?.submitted === true);
  return {
    id: iv.id,
    round: iv.round,
    status: iv.status,
    scheduledDate: iv.scheduledDate,
    location: iv.location,
    meetingLink: iv.meetingLink,
    roundOrdinal: decorated.roundOrdinal,
    roundMinutes: decorated.roundMinutes,
    requisition: { id: iv.requisition.id, title: iv.requisition.title },
    candidate: { id: iv.candidate.id, name: iv.candidate.name },
    panelists: decorated.panelists.map((p) => ({
      ...p,
      submitted: cards.some((c) => c.panelistId === p.userId && c.submitted),
    })),
    transcript: iv.transcript,
    notes: reveal ? iv.notes : null,
    aiAnalysis: reveal ? iv.aiAnalysis : null,
    recordingUrl: reveal ? iv.recordingUrl : null,
    judgmentsHidden: !reveal,
    myConfirmedAt: decorated.panelists.find((p) => p.userId === actor.userId)?.confirmedAt ?? null,
    can: { manage, score: decorated.panelists.some((p) => p.userId === actor.userId) },
  };
}

/** Candidates whose assessment left an interview focus, carried into round 1. */
export async function carriedFocus(requisitionId: string) {
  const rows = await prisma.hiringCandidate.findMany({
    where: {
      requisitionId,
      interviews: { some: {} },
      assessment: { interviewFocus: { not: null } },
    },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, assessment: { select: { interviewFocus: true } } },
  });
  return rows
    .map((c) => ({
      candidateId: c.id,
      candidateName: c.name,
      focus: (c.assessment?.interviewFocus ?? "").trim(),
    }))
    .filter((r) => r.focus.length > 0);
}
