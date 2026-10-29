import { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { deleteStoredFile, isStorageConfigured } from "@/lib/storage";
import { HiringRuleError } from "./http";
import { revokeMagicLinks } from "@/lib/core/tokens/magic-link";
import { CANDIDATE_STATUS_PURPOSE } from "./candidate-status";

/**
 * PDPL erasure of a candidate (Interview Hub `lib/pdpl.ts`). D6 fixed: the
 * source left the sealed salary expectation, HR's free-text notes, package
 * documents (and their files), negotiation notes and offer versions behind,
 * and tried to delete the CV under its API path instead of its blob pathname,
 * so the CV file was never removed. Here everything personal goes: the row's
 * identity and judgments, every child row's text, the offer's sealed pay and
 * terms, the AI insights, every stored file, and the values in the audit rows
 * of each erased record (who/when/what stays, the values do not).
 *
 * The candidate row itself stays as "[erased]" with `erasedAt`, so counts and
 * the funnel stay true. A candidate who became an employee is refused: their
 * data now lives on the people record and is erased there.
 */

const ERASED = "[erased]";
type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];
const CHILD_CAP = 1000;

async function redactAudit(tx: Tx, entityType: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx.auditLog.updateMany({
    where: { entityType, entityId: { in: ids } },
    data: { before: { erased: true }, after: { erased: true }, changes: { erased: true } },
  });
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/**
 * Soft-deleted rows are erased too. The soft-delete filter steps aside only
 * when a query names `deletedAt` itself, so read the live and the deleted
 * rows as two explicit queries.
 */
async function liveAndDeleted<T>(
  q: (deletedAt: null | { not: null }) => Promise<T[]>,
): Promise<T[]> {
  const [live, gone] = await Promise.all([q(null), q({ not: null })]);
  return [...live, ...gone];
}

async function eraseChildren(tx: Tx, candidateId: string, files: string[]) {
  const [interviews, cards, docs, notes, offers, history, handovers] = await Promise.all([
    liveAndDeleted((deletedAt) =>
      tx.hiringInterview.findMany({
        where: { candidateId, deletedAt },
        select: { id: true },
        take: CHILD_CAP,
      }),
    ),
    liveAndDeleted((deletedAt) =>
      tx.hiringScorecard.findMany({
        where: { candidateId, deletedAt },
        select: { id: true },
        take: CHILD_CAP,
      }),
    ),
    tx.hiringCandidateDocument.findMany({
      where: { candidateId },
      select: { id: true, blobPathname: true },
      take: CHILD_CAP,
    }),
    tx.hiringNegotiationNote.findMany({
      where: { candidateId },
      select: { id: true },
      take: CHILD_CAP,
    }),
    liveAndDeleted((deletedAt) =>
      tx.hiringOffer.findMany({
        where: { candidateId, deletedAt },
        select: { id: true, signedBlobPathname: true },
        take: 100,
      }),
    ),
    tx.hiringStageHistory.findMany({
      where: { candidateId },
      select: { id: true },
      take: CHILD_CAP,
    }),
    tx.hiringHandover.findMany({ where: { candidateId }, select: { id: true }, take: 100 }),
  ]);
  for (const r of interviews) {
    await tx.hiringInterview.update({
      where: { id: r.id },
      data: {
        transcript: null,
        notes: null,
        aiAnalysis: Prisma.DbNull,
        recordingUrl: null,
        notetakerDraft: null,
      },
      select: { id: true },
    });
  }
  for (const r of cards) {
    await tx.hiringScorecard.update({
      where: { id: r.id },
      data: { strengths: null, concerns: null, notes: null },
      select: { id: true },
    });
  }
  for (const d of docs) {
    if (d.blobPathname) files.push(d.blobPathname);
    await tx.hiringCandidateDocument.delete({ where: { id: d.id }, select: { id: true } });
  }
  for (const n of notes)
    await tx.hiringNegotiationNote.delete({ where: { id: n.id }, select: { id: true } });
  const offerIds = ids(offers);
  const versions = offerIds.length
    ? await tx.hiringOfferVersion.findMany({
        where: { offerId: { in: offerIds } },
        select: { id: true },
        take: CHILD_CAP,
      })
    : [];
  for (const v of versions) {
    await tx.hiringOfferVersion.update({
      where: { id: v.id },
      data: { termsSnapshotEnc: ERASED, summary: ERASED, candidateNote: null },
      select: { id: true },
    });
  }
  for (const o of offers) {
    if (o.signedBlobPathname) files.push(o.signedBlobPathname);
    await tx.hiringOffer.update({
      where: { id: o.id },
      data: {
        salaryEnc: null,
        allowancesEnc: null,
        benefits: null,
        noticeDetail: null,
        signedBlobPathname: null,
        signedFileName: null,
      },
      select: { id: true },
    });
  }
  // Core approval rounds carry the candidate's name as their title (ADR-094).
  const rounds = offerIds.length
    ? await tx.approvalRequest.findMany({
        where: { subjectType: "hiring.offer", subjectId: { in: offerIds } },
        select: { id: true },
        take: CHILD_CAP,
      })
    : [];
  for (const r of rounds)
    await tx.approvalRequest.update({
      where: { id: r.id },
      data: { title: ERASED },
      select: { id: true },
    });
  for (const h of history)
    await tx.hiringStageHistory.update({
      where: { id: h.id },
      data: { reason: null },
      select: { id: true },
    });
  for (const h of handovers)
    await tx.hiringHandover.update({
      where: { id: h.id },
      data: { note: null },
      select: { id: true },
    });
  const insightTargets = [candidateId, ...ids(interviews)];
  const insights = await tx.hiringAiInsight.findMany({
    where: { entityId: { in: insightTargets } },
    select: { id: true },
    take: CHILD_CAP,
  });
  for (const i of insights)
    await tx.hiringAiInsight.delete({ where: { id: i.id }, select: { id: true } });
  await redactAudit(tx, "HiringInterview", ids(interviews));
  await redactAudit(tx, "HiringScorecard", ids(cards));
  await redactAudit(tx, "HiringCandidateDocument", ids(docs));
  await redactAudit(tx, "HiringNegotiationNote", ids(notes));
  await redactAudit(tx, "HiringOffer", offerIds);
  await redactAudit(tx, "ApprovalRequest", ids(rounds));
  await redactAudit(tx, "HiringOfferVersion", ids(versions));
  await redactAudit(tx, "HiringStageHistory", ids(history));
  await redactAudit(tx, "HiringAiInsight", ids(insights));
}

/** Erase one candidate. Returns false when already erased. Files are removed after commit. */
export async function eraseCandidate(candidateId: string, by: string): Promise<boolean> {
  const select = {
    id: true,
    erasedAt: true,
    employeeId: true,
    cvBlobPathname: true,
    deletedAt: true,
  } as const;
  const c =
    (await prisma.hiringCandidate.findFirst({ where: { id: candidateId }, select })) ??
    (await prisma.hiringCandidate.findFirst({
      where: { id: candidateId, deletedAt: { not: null } },
      select,
    }));
  if (!c) throw new HiringRuleError("Not found.", 404);
  if (c.erasedAt) return false;
  if (c.employeeId) {
    throw new HiringRuleError(
      "This candidate is now an employee. Erase their data from the people record instead.",
      409,
    );
  }
  const files: string[] = c.cvBlobPathname ? [c.cvBlobPathname] : [];
  await auditedTransaction(async (tx) => {
    await eraseChildren(tx, c.id, files);
    const assessment = await tx.hiringAssessment.findUnique({
      where: { candidateId: c.id },
      select: { id: true },
    });
    if (assessment)
      await tx.hiringAssessment.update({
        where: { id: assessment.id },
        data: { interviewFocus: null },
        select: { id: true },
      });
    await tx.hiringCandidate.update({
      where: { id: c.id },
      data: erasedFields(by, c.deletedAt),
      select: { id: true },
    });
    await redactAudit(tx, "HiringCandidate", [c.id]);
  });
  // P2-11 — an erased candidate's status link stops working.
  await revokeMagicLinks(CANDIDATE_STATUS_PURPOSE, c.id);
  if (files.length && isStorageConfigured()) {
    for (const f of files)
      await deleteStoredFile(f).catch(() =>
        console.error("hiring erasure: a stored file could not be deleted"),
      );
  }
  return true;
}

function erasedFields(by: string, deletedAt: Date | null): Prisma.HiringCandidateUpdateInput {
  const now = new Date();
  return {
    name: ERASED,
    email: null,
    phone: null,
    nationality: null,
    currentEmployer: null,
    linkedinUrl: null,
    cvBlobPathname: null,
    cvFileName: null,
    deiGender: null,
    deiEthnicity: null,
    profileData: Prisma.DbNull,
    necEnc: null,
    salaryExpectationEnc: null,
    sourceAttribution: null,
    fitScores: Prisma.DbNull,
    aiRationale: null,
    aiWhyNot: null,
    rejectionReason: null,
    rejectionNotes: null,
    stallNote: null,
    preferredNote: null,
    packageDeclinedReason: null,
    agencyName: null,
    agencySubmissionNote: null,
    erasedAt: now,
    deletedAt: deletedAt ?? now,
    deletedBy: deletedAt ? undefined : by,
  };
}
