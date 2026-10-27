import type { HiringApprovalRole, HiringOfferStatus } from "@/generated/prisma/client";
import type { BandStatus, OfferTerms } from "@/lib/hiring/offer-package";

/** Payloads of `/api/hiring/offers/*` (lib/hiring/offers.ts and friends). */
export type OfferStatus = HiringOfferStatus;

type OfferBase = {
  id: string;
  status: OfferStatus;
  startDate: string;
  probationMonths: number;
  noticePeriod: string | null;
  contractType: string | null;
  benefits: string | null;
  salary: number | null;
  allowances: Record<string, number> | null;
  payUnreadable: boolean;
  compHidden: boolean;
  submittedById: string | null;
  joiningDate: string | null;
  noticeDetail: string | null;
  signedFileName: string | null;
  signedSizeBytes: number | null;
  signedAt: string | null;
  countersignedBy: string | null;
  countersignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  candidate: { id: string; name: string; stage: string };
  requisition: {
    id: string;
    title: string;
    grade: string | null;
    entity: { code: string; name: string } | null;
    salaryBandMin: number | null;
    salaryBandMax: number | null;
  };
};

export type OfferListRow = OfferBase & { escalatesCoo: boolean | null; submittedBy: string | null };

export type OfferDetail = OfferBase & {
  can: {
    manage: boolean;
    edit: boolean;
    transitions: OfferStatus[];
    revise: boolean;
    accept: boolean;
    uploadSigned: boolean;
    letter: boolean;
    notes: boolean;
    postNotes: boolean;
    delete: boolean;
  };
};

export type ChainStepView = {
  sequence: number;
  role: HiringApprovalRole;
  approvers: { id: string; name: string; email: string }[];
  recused: boolean;
  state: "APPROVED" | "REJECTED" | "SENT_BACK" | "AWAITING" | "PENDING";
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
};

export type ApprovalViewData = {
  preview: boolean;
  status: OfferStatus;
  chain: ChainStepView[];
  nextSequence: number | null;
  canDecide: boolean;
  refusal: string | null;
  submittedBy: string | null;
  submittedByYou: boolean;
  checklist: { packageConfirmed: string | null; band: BandStatus | null };
};

export type VersionView = {
  id: string;
  versionNumber: number;
  summary: string;
  changedFields: string[];
  compChanged: boolean;
  restartedApproval: boolean;
  candidateNote: string | null;
  createdByName: string;
  createdAt: string;
  current: boolean;
  terms: OfferTerms | null;
};

export type NoteView = {
  id: string;
  kind: "PRE_OFFER_ALIGNMENT" | "NEGOTIATION";
  body: string;
  authorName: string;
  discussedSalary: number | null;
  discussedStartDate: string | null;
  candidateConfirmed: boolean;
  createdAt: string;
};
