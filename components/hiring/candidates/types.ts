import type { PersonRef } from "@/lib/hiring/people";

/** The candidate record as `GET /api/hiring/candidates/[id]` serialises it. */
export type CandidateDetail = {
  id: string;
  name: string;
  stage: string;
  source: string;
  sourceAttribution: string | null;
  createdAt: string;
  requisition: { id: string; title: string } | null;
  referredBy: PersonRef | null;
  hasOffer: boolean;
  offer: { id: string; status: string } | null;
  interviews: { id: string; round: string; scheduledDate: string; status: string }[];
  history: {
    id: string;
    fromStage: string;
    toStage: string;
    reason: string | null;
    movedAt: string;
    movedBy: PersonRef | null;
  }[];
  preferred: { at: string; note: string | null; by: PersonRef | null } | null;
  stall: { cause: string; note: string | null; at: string; by: PersonRef | null } | null;
  packageStatus: string;
  packageConfirmedAt: string | null;
  packageDeclinedAt: string | null;
  contact: {
    email: string | null;
    phone: string | null;
    nationality: string | null;
    currentEmployer: string | null;
    linkedinUrl: string | null;
    nec: string | null;
    hasCv: boolean;
    cvFileName: string | null;
    profileData: unknown;
    fitScores: unknown;
    overallScore: number | null;
    aiRationale: string | null;
    aiWhyNot: string | null;
    rejectionReason: string | null;
    rejectionNotes: string | null;
    agencyName: string | null;
    agencySubmissionNote: string | null;
    referredById: string | null;
  } | null;
  dei: { gender: string | null } | null;
  salaryExpectation: number | null;
  can: {
    manage: boolean;
    overrideGates: boolean;
    viewPii: boolean;
    viewDei: boolean;
    viewComp: boolean;
  };
};
