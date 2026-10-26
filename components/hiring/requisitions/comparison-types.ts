import type { HiringStage } from "@/generated/prisma/client";
import type {
  CompetencyAverage,
  Coverage,
  HireVote,
  VerdictSummary,
} from "@/lib/hiring/scorecard-math";

/** The `/api/hiring/requisitions/[id]/comparison` payload (`loadComparison`). */
export type FeedbackEntry = {
  panelistId: string;
  name: string;
  initials: string;
  isHiringManager: boolean;
  rounds: string;
  vote: HireVote | null;
  comment: string | null;
  commentSource: "notes" | "strengths" | "concerns" | null;
  submittedCount: number;
  slotCount: number;
};

export type Finalist = {
  candidateId: string;
  name: string;
  initials: string;
  stage: HiringStage;
  preferred: boolean;
  preferredAt: string | null;
  preferredByName: string | null;
  preferredNote: string | null;
  preferredOutstandingScorecards: number | null;
  averages: CompetencyAverage[];
  weighted: number | null;
  verdict: VerdictSummary;
  coverage: Coverage;
  feedback: FeedbackEntry[];
};

export type Comparison = {
  requisition: { id: string; title: string; competencies: string[] };
  finalists: Finalist[];
  coverage: Coverage;
  preferredCandidateId: string | null;
};
