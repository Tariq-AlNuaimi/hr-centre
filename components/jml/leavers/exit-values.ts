/** The exit date model as a form holds it (strings), and its payload. */

export const EXIT_TYPES = [
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
] as const;
export const EXIT_SUBTYPES = ["PERFORMANCE", "CONDUCT", "BUSINESS", "OTHER"] as const;
export const DEFAULT_NOTICE: Record<string, number> = {
  RESIGNATION: 60,
  TERMINATION: 30,
  CONTRACT_EXPIRY: 30,
  PROBATION_EXIT: 7,
  SUMMARY_DISMISSAL: 0,
};
export const DOCUMENTED = new Set(["TERMINATION", "SUMMARY_DISMISSAL"]);

export type ExitValues = {
  exitType: string;
  exitSubtype: string;
  nationality: string;
  noticeStartDate: string;
  noticePeriodDays: string;
  noticePeriodOverrideReason: string;
  lastPhysicalWorkingDay: string;
  lastDayOfService: string;
  departureDate: string;
};

export const EMPTY_EXIT: ExitValues = {
  exitType: "RESIGNATION",
  exitSubtype: "",
  nationality: "",
  noticeStartDate: "",
  noticePeriodDays: "60",
  noticePeriodOverrideReason: "",
  lastPhysicalWorkingDay: "",
  lastDayOfService: "",
  departureDate: "",
};

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export function datesPayload(v: ExitValues) {
  return {
    exitType: v.exitType,
    exitSubtype: v.exitType === "TERMINATION" ? orNull(v.exitSubtype) : null,
    nationality: orNull(v.nationality),
    noticeStartDate: v.noticeStartDate,
    noticePeriodDays: Number(v.noticePeriodDays || 0),
    noticePeriodOverrideReason:
      Number(v.noticePeriodDays || 0) === DEFAULT_NOTICE[v.exitType]
        ? null
        : orNull(v.noticePeriodOverrideReason),
    lastPhysicalWorkingDay: orNull(v.lastPhysicalWorkingDay),
    lastDayOfService: orNull(v.lastDayOfService),
    departureDate: v.nationality === "OMANI" ? null : orNull(v.departureDate),
  };
}
