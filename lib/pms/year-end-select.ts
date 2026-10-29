import type { Prisma } from "@/generated/prisma/client";
import { RATING_LEVELS } from "./rating";

/**
 * §7.1's assessment payload, defined ONCE.
 *
 * Two screens ask the same question — "what is this person's year-end set, and
 * who has rated what" — and before this they each answered it with their own
 * hand-written `select`. That is the exact shape of the §6.2 defect this repo
 * hit a day earlier: HR's mid-year screen kept its own field list, the
 * acknowledgment columns were added to the shared one, and the screen that most
 * needed them was the only reader not selecting them. Nothing warned, because
 * two independent selects cannot disagree out loud.
 *
 * So the manager/HR participant page and the employee's own `/api/year-end/me`
 * read THIS. A column added here reaches both, or neither.
 *
 * §4.5 — salary is absent by construction, not by filtering: the employee
 * columns are enumerated and `basicSalaryEnc` is not among them.
 */
export const YEAR_END_KPI_SELECT = {
  id: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
  ratings: {
    select: { party: true, level: true, comment: true, ratedAt: true },
  },
  // §7.1 evidence. Passing `canViewEmployee` is NOT enough to receive these
  // rows — that was the original mistake here, and this comment asserted the
  // opposite. `canViewEmployee` spans the whole downward chain plus org-wide
  // viewers, so a skip-level manager and the COO were handed the file list and
  // the manager's notes on it. `serializeYearEndKpis` now takes an explicit
  // `includeEvidence`, and every caller must compute `canViewEvidence` to
  // decide it.
  //
  // Soft-deleted items are excluded here rather than filtered downstream, so a
  // withdrawn item cannot reappear on a screen that forgot to check.
  evidence: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: "asc" },
    take: 10,
    select: {
      id: true,
      kind: true,
      label: true,
      url: true,
      contentType: true,
      sizeBytes: true,
      uploadedAt: true,
      managerComment: true,
      managerCommentAt: true,
    },
  },
  // P2-3 — the rating context panel: what was agreed about THIS KPI at mid-year.
  // Only APPROVED requests changed the KPI; the latest one is the context. The
  // rationale and decision are text both parties already saw on mid-year.
  changeEdits: {
    where: { request: { status: "APPROVED" } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      request: { select: { rationale: true, decisionReason: true, decidedAt: true } },
    },
  },
} satisfies Prisma.KpiSelect;

/** The ordering §5.2 reads the set in; shared so both screens agree. */
export const YEAR_END_KPI_ORDER = [
  { orderIndex: "asc" },
  { createdAt: "asc" },
] satisfies Prisma.KpiOrderByWithRelationInput[];

type RatingRow = {
  party: "EMPLOYEE" | "MANAGER";
  level: number;
  comment: string | null;
  ratedAt: Date;
};
type EvidenceRow = {
  id: string;
  kind: "FILE" | "LINK";
  label: string;
  url: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: Date;
  managerComment: string | null;
  managerCommentAt: Date | null;
};

type KpiRow = {
  id: string;
  description: string;
  weightage: { toString(): string };
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
  ratings: RatingRow[];
  evidence: EvidenceRow[];
  changeEdits: {
    request: { rationale: string; decisionReason: string | null; decidedAt: Date | null };
  }[];
};

/** P2-3 — the latest approved mid-year change to a KPI. */
export type MidYearNote = {
  rationale: string;
  decisionReason: string | null;
  decidedAt: string | null;
};

/** One KPI as the assessment screen consumes it. Mirrors `YearEndKpi`. */
export type SerializedYearEndKpi = {
  id: string;
  description: string;
  weightage: string;
  levels: { level: number; text: string }[];
  employeeRating: { level: number; comment: string | null; ratedAt: string } | null;
  managerRating: { level: number; comment: string | null; ratedAt: string } | null;
  evidence: {
    id: string;
    kind: "FILE" | "LINK";
    label: string;
    /** LINK only. A FILE has no URL — it is opened through the read route. */
    url: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    uploadedAt: string;
    managerComment: string | null;
    managerCommentAt: string | null;
  }[];
  midYearNote: MidYearNote | null;
};

/**
 * Rows → the screen's shape. The Decimal crosses as a STRING, the same rule
 * `serializeKpi` follows: JSON's only numeric type is a double and §5.3/§8.2
 * compare against exactly 100.
 */
export function serializeYearEndKpis(
  kpis: KpiRow[],
  /**
   * Whether this viewer may see the evidence (`canViewEvidence`). Required
   * rather than defaulted: a default would be the wrong answer for one of the
   * two callers, and the version of this function without it shipped the file
   * list to every skip-level manager in the chain.
   */
  opts: { includeEvidence: boolean },
): SerializedYearEndKpi[] {
  return kpis.map((kpi) => {
    const find = (party: "EMPLOYEE" | "MANAGER") => {
      const r = kpi.ratings.find((x) => x.party === party);
      return r ? { level: r.level, comment: r.comment, ratedAt: r.ratedAt.toISOString() } : null;
    };
    return {
      id: kpi.id,
      description: kpi.description,
      weightage: kpi.weightage.toString(),
      // §7.1 — the five sentences the manager authored for THIS KPI, in §8.1's
      // order. The screen asks which one describes the year; the number is only
      // how §8 will later score it.
      levels: RATING_LEVELS.map(({ level, field }) => ({ level, text: kpi[field] })),
      employeeRating: find("EMPLOYEE"),
      managerRating: find("MANAGER"),
      // No URL is produced for a FILE here, deliberately: there is no public
      // one, and a signed URL minted at list time would outlive the check that
      // authorised it. The screen links to the read route instead.
      evidence: (opts.includeEvidence ? kpi.evidence : []).map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        url: e.url,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        uploadedAt: e.uploadedAt.toISOString(),
        managerComment: e.managerComment,
        managerCommentAt: e.managerCommentAt?.toISOString() ?? null,
      })),
      midYearNote: midYearNoteOf(kpi),
    };
  });
}

/** P2-3 — the latest approved mid-year change to a KPI, as context for rating it. */
function midYearNoteOf(kpi: KpiRow): MidYearNote | null {
  const request = kpi.changeEdits[0]?.request;
  if (!request) return null;
  return {
    rationale: request.rationale,
    decisionReason: request.decisionReason,
    decidedAt: request.decidedAt?.toISOString() ?? null,
  };
}
