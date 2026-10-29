import type { Person } from "../ui/person-picker";

/** The requisition record as `GET /api/hiring/requisitions/[id]` returns it. */
export type RequisitionDetail = {
  id: string;
  title: string;
  status: string;
  jdStatus: string;
  jdVersion: number;
  jdApprovedAt: string | null;
  entityId: string;
  departmentId: string | null;
  entity: { id: string; code: string; name: string } | null;
  departmentName: string | null;
  description: string;
  competencies: string[];
  grade: string | null;
  openings: number;
  salaryCurrency: string;
  salaryBandMin: number | null;
  salaryBandMax: number | null;
  bandHidden: boolean;
  targetCloseDate: string | null;
  businessNeed: string | null;
  alternativesConsidered: string | null;
  hmSeesSalary: boolean;
  locationCity: string;
  locationCountry: string;
  workArrangement: "ON_SITE" | "HYBRID" | "REMOTE";
  hiringManager: Person | null;
  owner: Person | null;
  seatsFilled: number;
  seatsRemaining: number;
  fillLabel: string;
  liveOnCareers: boolean;
  createdAt: string;
  can: { manage: boolean; viewPii: boolean };
};

export type StatusHistoryRow = {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  changedAt: string;
  changedBy: Person | null;
};
