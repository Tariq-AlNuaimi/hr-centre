import type { HireVote } from "@/lib/hiring/scorecard-math";
import type { PanelAiMode } from "@/lib/hiring/interview-rules";

/** Payloads of `/api/hiring/panel/*` (`lib/hiring/panel.ts`). */
export type PanelRow = {
  id: string;
  round: string;
  status: string;
  scheduledDate: string;
  location: string | null;
  candidate: { id: string; name: string };
  requisition: { id: string; title: string };
  competencies: string[];
  submitted: boolean;
  myVote: HireVote | null;
};

export type AnchorMap = Partial<Record<"1" | "2" | "3" | "4" | "5", string>>;

export type Brief = {
  interview: {
    id: string;
    round: string;
    roundOrdinal: number;
    scheduledDate: string;
    location: string | null;
  };
  candidate: {
    id: string;
    name: string;
    currentEmployer: string | null;
    summary: string | null;
    experience: {
      title: string | null;
      company: string | null;
      period: string | null;
      description: string | null;
    }[];
    skills: string[];
  };
  requisition: { id: string; title: string };
  competencies: string[];
  anchors: Record<string, AnchorMap | null>;
  questions: {
    id: string;
    questionText: string;
    competency: string | null;
    category: string | null;
  }[];
  panelAiMode: PanelAiMode;
  alreadySubmitted: boolean;
};

export type MyCard = {
  id: string;
  scores: Record<string, number> | null;
  strengths: string | null;
  concerns: string | null;
  notes: string | null;
  vote: HireVote;
  submitted: boolean;
  submittedAt: string | null;
};

export type ComparePayload =
  | { locked: true; mode: PanelAiMode; mine: MyCard | null }
  | {
      locked: false;
      mode: PanelAiMode;
      mine: MyCard | null;
      peers: {
        panelistId: string;
        name: string;
        vote: HireVote;
        scores: Record<string, number> | null;
        strengths: string | null;
        concerns: string | null;
      }[];
      ai: { output: unknown; model: string | null; createdAt: string } | null;
    };
