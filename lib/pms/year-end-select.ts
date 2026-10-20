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
};

/** One KPI as the assessment screen consumes it. Mirrors `YearEndKpi`. */
export type SerializedYearEndKpi = {
  id: string;
  description: string;
  weightage: string;
  levels: { level: number; text: string }[];
  employeeRating: { level: number; comment: string | null; ratedAt: string } | null;
  managerRating: { level: number; comment: string | null; ratedAt: string } | null;
};

/**
 * Rows → the screen's shape. The Decimal crosses as a STRING, the same rule
 * `serializeKpi` follows: JSON's only numeric type is a double and §5.3/§8.2
 * compare against exactly 100.
 */
export function serializeYearEndKpis(kpis: KpiRow[]): SerializedYearEndKpi[] {
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
    };
  });
}
