/** An interview row as the list and schedule APIs serialise it. */
export type InterviewRow = {
  id: string;
  round: string;
  status: string;
  scheduledDate: string;
  location: string | null;
  meetingLink: string | null;
  requisition: { id: string; title: string };
  candidate: { id: string; name: string };
  panelists: { userId: string; name: string; email: string | null; confirmedAt: string | null }[];
  roundOrdinal: number;
  roundMinutes: number;
};

/** `/api/hiring/interviews/[id]` (`interviewDetail`). */
export type InterviewDetailData = {
  id: string;
  round: string;
  status: string;
  scheduledDate: string;
  location: string | null;
  meetingLink: string | null;
  roundOrdinal: number;
  requisition: { id: string; title: string };
  candidate: { id: string; name: string };
  panelists: {
    userId: string;
    name: string;
    email: string | null;
    confirmedAt: string | null;
    submitted: boolean;
  }[];
  transcript: string | null;
  notes: string | null;
  aiAnalysis: unknown;
  judgmentsHidden: boolean;
  myConfirmedAt: string | null;
  can: { manage: boolean; score: boolean };
};
