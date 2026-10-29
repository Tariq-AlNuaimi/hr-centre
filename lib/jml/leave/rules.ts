import type { JmlExitType } from "@/generated/prisma/client";

/**
 * Leaver rules that need no database — HR Offboarding
 * `lib/validations/offboarding/exit-case.ts` (`DEFAULT_NOTICE_DAYS`,
 * `refineDates`) and the nationality branch. Pure.
 */

/** §8.3 default notice per exit type; a different length needs a recorded reason. */
export const DEFAULT_NOTICE_DAYS: Record<JmlExitType, number> = {
  RESIGNATION: 60,
  TERMINATION: 30,
  CONTRACT_EXPIRY: 30,
  PROBATION_EXIT: 7,
  SUMMARY_DISMISSAL: 0,
};

export const DOCUMENTED_EXIT_TYPES: ReadonlySet<string> = new Set([
  "TERMINATION",
  "SUMMARY_DISMISSAL",
]);

export type DateFacts = {
  exitType: JmlExitType;
  exitSubtype: string | null;
  nationality: "OMANI" | "EXPATRIATE";
  noticeStartDate: Date;
  noticePeriodDays: number;
  noticePeriodOverrideReason: string | null;
  lastPhysicalWorkingDay: Date | null;
  lastDayOfService: Date | null;
  departureDate: Date | null;
};

export type Problem = { field: string; message: string };

/**
 * The three-date model (§6.2) and its neighbours. Offboarding F12 fixed: this
 * runs on the draft AND again at activation, not only on the date-change form.
 */
export function dateProblems(v: DateFacts): Problem[] {
  const out: Problem[] = [];
  const lpwd = v.lastPhysicalWorkingDay;
  const lds = v.lastDayOfService;
  if (lpwd && lds && lds < lpwd) {
    out.push({
      field: "lastDayOfService",
      message:
        "Last Day of Service cannot be before Last Physical Working Day. Service continues through any leave taken in lieu of notice.",
    });
  }
  if (lpwd && lpwd < v.noticeStartDate) {
    out.push({
      field: "lastPhysicalWorkingDay",
      message: "Last Physical Working Day cannot be before the Notice Start Date.",
    });
  }
  if (v.departureDate) {
    if (v.nationality !== "EXPATRIATE") {
      out.push({
        field: "departureDate",
        message: "Departure Date applies to expatriate exits only.",
      });
    }
    if (lds && v.departureDate < lds) {
      out.push({
        field: "departureDate",
        message: "Departure Date cannot be before the Last Day of Service.",
      });
    }
  }
  const standard = DEFAULT_NOTICE_DAYS[v.exitType];
  if (v.noticePeriodDays !== standard && !v.noticePeriodOverrideReason?.trim()) {
    out.push({
      field: "noticePeriodOverrideReason",
      message: `Notice period ${v.noticePeriodDays} differs from the ${standard}-day default for ${v.exitType.replaceAll("_", " ").toLowerCase()}. A reason is required to override it.`,
    });
  }
  if (v.exitType === "TERMINATION" && !v.exitSubtype) {
    out.push({
      field: "exitSubtype",
      message: "Exit Subtype is required for a termination.",
    });
  }
  return out;
}

/** The branch a free-text nationality falls in (Offboarding's OMANI / EXPATRIATE). */
export function nationalityBranch(
  nationality: string | null | undefined,
): "OMANI" | "EXPATRIATE" | null {
  const n = nationality?.trim().toLowerCase();
  if (!n) return null;
  return n === "omani" || n === "oman" ? "OMANI" : "EXPATRIATE";
}

/** Count-led refusal sentence (Offboarding `describeRefusal`). */
export function describeRefusal(problems: readonly Problem[]): string {
  const messages = problems.map((p) => p.message.trim()).filter(Boolean);
  if (messages.length === 0) return "This case cannot be activated yet.";
  if (messages.length === 1) return messages[0]!;
  return `This case cannot be activated yet — ${messages.length} things need attention. ${messages.join(" ")}`;
}
