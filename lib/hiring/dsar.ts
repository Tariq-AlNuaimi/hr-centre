import { prisma } from "@/lib/prisma";
import { openAmount, openNec } from "./comp-crypto";
import { HiringRuleError } from "./http";

/**
 * A data-subject access export (Interview Hub `GET /api/candidates/[id]/dsar`):
 * everything Hiring holds about one candidate, Restricted fields opened. Hiring
 * erase rights only (org-wide); the route marks it no-store. Offer pay is the
 * candidate's own data too, so it is included; AI judgments are included as
 * stored. File bytes are not inlined — their names are listed.
 */
export async function dsarExport(candidateId: string) {
  const c =
    (await prisma.hiringCandidate.findFirst({ where: { id: candidateId }, include: INCLUDE })) ??
    (await prisma.hiringCandidate.findFirst({
      where: { id: candidateId, deletedAt: { not: null } },
      include: INCLUDE,
    }));
  if (!c) throw new HiringRuleError("Not found.", 404);
  const { necEnc, salaryExpectationEnc, offers, documents, negotiationNotes, ...rest } = c;
  return {
    exportedAt: new Date().toISOString(),
    candidate: {
      ...rest,
      nationalId: openNec(c.id, necEnc),
      salaryExpectation: openAmount("candidate", c.id, "salaryExpectation", salaryExpectationEnc),
    },
    offers: offers.map(({ salaryEnc, allowancesEnc, ...o }) => ({
      ...o,
      salary: openAmount("offer", o.id, "salary", salaryEnc),
      allowancesSealed: allowancesEnc !== null,
    })),
    documents: documents.map(({ statedAmountEnc, ...d }) => ({
      ...d,
      statedAmount: openAmount("document", d.id, "statedAmount", statedAmountEnc),
    })),
    negotiationNotes: negotiationNotes.map(({ discussedSalaryEnc, ...n }) => ({
      ...n,
      discussedSalary: openAmount("negotiationNote", n.id, "discussedSalary", discussedSalaryEnc),
    })),
  };
}

const INCLUDE = {
  stageHistory: { orderBy: { movedAt: "asc" as const }, take: 500 },
  interviews: {
    take: 200,
    select: {
      id: true,
      round: true,
      scheduledDate: true,
      status: true,
      transcript: true,
      notes: true,
      aiAnalysis: true,
    },
  },
  scorecards: {
    take: 500,
    select: {
      id: true,
      interviewId: true,
      scores: true,
      strengths: true,
      concerns: true,
      vote: true,
      notes: true,
      submittedAt: true,
    },
  },
  offers: {
    take: 50,
    select: {
      id: true,
      status: true,
      startDate: true,
      contractType: true,
      salaryEnc: true,
      allowancesEnc: true,
      benefits: true,
      signedFileName: true,
      createdAt: true,
    },
  },
  documents: {
    take: 200,
    select: {
      id: true,
      kind: true,
      label: true,
      fileName: true,
      periodMonth: true,
      statedAmountEnc: true,
      currency: true,
      createdAt: true,
    },
  },
  negotiationNotes: {
    take: 500,
    select: {
      id: true,
      kind: true,
      body: true,
      discussedSalaryEnc: true,
      discussedStartDate: true,
      createdAt: true,
    },
  },
  assessment: true,
} as const;
