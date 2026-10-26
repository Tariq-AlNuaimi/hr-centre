import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canOverrideGates, type HiringActor } from "./access";
import {
  candidateReadWhere,
  projectRows,
  seesCandidateComp,
  type LoadedCandidate,
} from "./candidates";
import { isOmani } from "./candidate-rules";
import { openAmount, openNec } from "./comp-crypto";
import { peopleById, personOrNull } from "./people";
import { boardStepForStage } from "./stage-rules";

/** The candidate record for its screens, and the board's cards. */

const HISTORY_CAP = 200;
const BOARD_CAP = 1000;

export async function candidateHistory(candidateId: string) {
  const rows = await prisma.hiringStageHistory.findMany({
    where: { candidateId },
    orderBy: { movedAt: "desc" },
    take: HISTORY_CAP,
  });
  const people = await peopleById(rows.map((r) => r.movedById));
  return rows.map((r) => ({
    id: r.id,
    fromStage: r.fromStage,
    toStage: r.toStage,
    reason: r.reason,
    movedAt: r.movedAt,
    movedBy: personOrNull(people, r.movedById),
  }));
}

/**
 * Everything a profile shows, projected by right: PII (`hiring.viewPii`), DEI
 * (`hiring.viewDei`), the expectation (comp rules), decrypting only what the
 * reader may see. The stall reason counts only while the candidate is still at
 * the stage it was recorded against.
 */
export async function candidateDetail(actor: HiringActor, l: LoadedCandidate) {
  const c = l.cand;
  const pii = can(actor, "hiring.viewPii", l.subject);
  const dei = can(actor, "hiring.viewDei", l.subject);
  const comp = seesCandidateComp(actor, l);
  const [history, interviews, offers, people] = await Promise.all([
    candidateHistory(c.id),
    prisma.hiringInterview.findMany({
      where: { candidateId: c.id },
      orderBy: { scheduledDate: "asc" },
      select: { id: true, round: true, scheduledDate: true, status: true },
      take: 50,
    }),
    prisma.hiringOffer.count({ where: { candidateId: c.id } }),
    peopleById([c.referredById, c.stallCauseById, c.preferredById]),
  ]);
  const stallCurrent = c.stallCause && c.stallCauseStage === c.stage;
  return {
    id: c.id,
    name: c.name,
    stage: c.stage,
    source: c.source,
    sourceAttribution: c.sourceAttribution,
    createdAt: c.createdAt,
    requisition: c.requisition ? { id: c.requisition.id, title: c.requisition.title } : null,
    referredBy: personOrNull(people, c.referredById),
    hasOffer: offers > 0,
    interviews,
    history,
    preferred: c.preferredAt
      ? {
          at: c.preferredAt,
          note: pii ? c.preferredNote : null,
          by: personOrNull(people, c.preferredById),
        }
      : null,
    stall: stallCurrent
      ? {
          cause: c.stallCause,
          note: c.stallNote,
          at: c.stallCauseAt,
          by: personOrNull(people, c.stallCauseById),
        }
      : null,
    packageStatus: c.packageStatus,
    packageConfirmedAt: c.packageConfirmedAt,
    packageDeclinedAt: c.packageDeclinedAt,
    contact: pii
      ? {
          email: c.email,
          phone: c.phone,
          nationality: c.nationality,
          currentEmployer: c.currentEmployer,
          linkedinUrl: c.linkedinUrl,
          nec: openNec(c.id, c.necEnc),
          hasCv: Boolean(c.cvBlobPathname),
          cvFileName: c.cvFileName,
          profileData: c.profileData,
          fitScores: c.fitScores,
          overallScore: c.overallScore,
          aiRationale: c.aiRationale,
          aiWhyNot: c.aiWhyNot,
          rejectionReason: c.rejectionReason,
          rejectionNotes: c.rejectionNotes,
          agencyName: c.agencyName,
          agencySubmissionNote: c.agencySubmissionNote,
          referredById: c.referredById,
        }
      : null,
    dei: dei ? { gender: c.deiGender } : null,
    salaryExpectation: comp
      ? openAmount("candidate", c.id, "salaryExpectation", c.salaryExpectationEnc)
      : null,
    can: {
      manage: can(actor, "hiring.manage", l.subject),
      overrideGates: canOverrideGates(actor, l.subject),
      viewPii: pii,
      viewDei: dei,
      viewComp: comp,
    },
  };
}

/** Board cards across the actor's scope (optionally one requisition), capped and honest. */
export async function boardCards(actor: HiringActor, requisitionId?: string) {
  const scope = await candidateReadWhere(actor, "hiring.manage");
  if (scope === null) return { cards: [], truncated: false };
  const where: Prisma.HiringCandidateWhereInput = {
    AND: [scope, { stage: { notIn: ["REJECTED", "WITHDRAWN"] } }],
    ...(requisitionId ? { requisitionId } : {}),
  };
  const rows = await prisma.hiringCandidate.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: BOARD_CAP + 1,
    select: {
      id: true,
      name: true,
      email: true,
      nationality: true,
      currentEmployer: true,
      stage: true,
      source: true,
      overallScore: true,
      createdAt: true,
      updatedAt: true,
      requisition: { select: { id: true, title: true, entityId: true, departmentId: true } },
      stageHistory: { orderBy: { movedAt: "desc" }, take: 1, select: { movedAt: true } },
      _count: { select: { offers: true } },
    },
  });
  const truncated = rows.length > BOARD_CAP;
  const kept = rows.slice(0, BOARD_CAP);
  const projected = await projectRows(actor, kept);
  const cards = projected.map((p, i) => {
    const r = kept[i];
    const hasOffer = r._count.offers > 0;
    return {
      id: p.id,
      name: p.name,
      stage: p.stage,
      requisitionTitle: p.requisition?.title ?? null,
      overallScore: p.overallScore,
      omani: p.nationality ? isOmani(p.nationality) : null,
      hasOffer,
      step: boardStepForStage(p.stage, hasOffer),
      inStageSince: r.stageHistory[0]?.movedAt ?? r.createdAt,
    };
  });
  return { cards, truncated };
}
