import type { HiringInterviewRound, HiringInterviewStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { notifyScorecardDue } from "./notify";
import { assertPanel, isPanelistOn, setPanel, type LoadedInterview } from "./interviews";
import { requisitionSubject } from "./scope";

/**
 * Scheduling writes. The requisition comes from the candidate — Interview Hub
 * took both ids from the form and never checked they agreed, so an interview
 * could belong to one opening while its candidate applied to another.
 */

export type InterviewInput = {
  candidateId: string;
  round: HiringInterviewRound;
  scheduledDate: Date;
  status: HiringInterviewStatus;
  location?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  panelistIds: string[];
};

export async function createInterview(actor: HiringActor, data: InterviewInput) {
  const cand = await prisma.hiringCandidate.findUnique({
    where: { id: data.candidateId },
    select: {
      id: true,
      referredById: true,
      erasedAt: true,
      requisition: { select: { id: true, entityId: true, departmentId: true } },
    },
  });
  if (!cand || cand.erasedAt) throw new HiringRuleError("That candidate was not found.", 404);
  if (!cand.requisition) {
    throw new HiringRuleError(
      "Assign the candidate to a requisition before scheduling an interview.",
      422,
    );
  }
  const subject = await requisitionSubject(cand.requisition);
  if (!can(actor, "hiring.manage", subject))
    throw new HiringRuleError("That candidate was not found.", 404);
  const panel = await assertPanel(subject, cand, data.panelistIds);
  const iv = await prisma.hiringInterview.create({
    data: {
      requisitionId: cand.requisition.id,
      candidateId: cand.id,
      round: data.round,
      scheduledDate: data.scheduledDate,
      status: data.status,
      location: data.location || null,
      meetingLink: data.meetingLink || null,
      notes: data.notes || null,
    },
    select: { id: true },
  });
  await setPanel(iv.id, panel);
  await notifyScorecardDue({
    interviewId: iv.id,
    scheduledDate: data.scheduledDate ?? null,
    panelistIds: data.panelistIds,
  });
  return iv;
}

export type InterviewUpdate = Partial<Omit<InterviewInput, "candidateId" | "panelistIds">> & {
  panelistIds?: string[];
  transcript?: string | null;
};

export async function updateInterview(l: LoadedInterview, data: InterviewUpdate) {
  const { panelistIds, ...fields } = data;
  const panel = panelistIds ? await assertPanel(l.subject, l.iv.candidate, panelistIds) : null;
  await prisma.hiringInterview.update({
    where: { id: l.iv.id },
    data: {
      ...fields,
      ...(fields.location !== undefined ? { location: fields.location || null } : {}),
      ...(fields.meetingLink !== undefined ? { meetingLink: fields.meetingLink || null } : {}),
    },
    select: { id: true },
  });
  if (panel) {
    await setPanel(l.iv.id, panel);
    // Newly added panelists hear it; the per-interview key keeps it to one each.
    await notifyScorecardDue({
      interviewId: l.iv.id,
      scheduledDate: fields.scheduledDate ?? l.iv.scheduledDate ?? null,
      panelistIds: panelistIds ?? [],
    });
  }
}

export async function addPanelist(l: LoadedInterview, userId: string) {
  if (await isPanelistOn(l.iv.id, userId))
    throw new HiringRuleError("Panelist already assigned.", 409);
  await assertPanel(l.subject, l.iv.candidate, [userId]);
  await prisma.hiringInterviewPanelist.create({
    data: { interviewId: l.iv.id, userId },
    select: { id: true },
  });
  await notifyScorecardDue({
    interviewId: l.iv.id,
    scheduledDate: l.iv.scheduledDate ?? null,
    panelistIds: [userId],
  });
}

/** D8 — removing is always allowed; recusal only ever blocks adding. */
export async function removePanelist(l: LoadedInterview, userId: string) {
  if (!(await isPanelistOn(l.iv.id, userId))) throw new HiringRuleError("Panelist not found.", 404);
  await prisma.hiringInterviewPanelist.delete({
    where: { interviewId_userId: { interviewId: l.iv.id, userId } },
  });
}

export async function confirmAttendance(
  actor: HiringActor,
  interviewId: string,
  confirmed: boolean,
) {
  if (!(await isPanelistOn(interviewId, actor.userId))) {
    throw new HiringRuleError("You are not a panelist on this interview.", 404);
  }
  const row = await prisma.hiringInterviewPanelist.update({
    where: { interviewId_userId: { interviewId, userId: actor.userId } },
    data: { confirmedAt: confirmed ? new Date() : null },
    select: { confirmedAt: true },
  });
  return row;
}
