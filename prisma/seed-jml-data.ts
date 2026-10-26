/**
 * JML reference data (docs/blueprints/jml.md) — REAL configuration seeded
 * idempotently in production. Pure data: no people, no cases.
 *
 * Exit reason taxonomy: HR Offboarding `lib/offboarding/taxonomy.ts` (§12.3,
 * 7 Level-1 categories, 35 Level-2 codes), verbatim. After seeding, the DATABASE
 * rows are the truth (defect F9 fixed): admins add and deactivate codes there.
 *
 * Statutory parameters: HR Offboarding `prisma/seed/statutory.ts` (§17.2), all
 * UNVERIFIED (artifact open item O1) — the HR Manager verifies each against its
 * legal source; settlement approval is blocked until then (AC-10.8).
 */

export const EXIT_REASON_LEVEL_1 = [
  "VOLUNTARY_ATTRACTED_AWAY",
  "VOLUNTARY_DISSATISFACTION",
  "VOLUNTARY_PERSONAL",
  "INVOLUNTARY_PERFORMANCE",
  "INVOLUNTARY_CONDUCT",
  "INVOLUNTARY_BUSINESS",
  "CONTRACT",
] as const;

type ExitReasonLevel1 = (typeof EXIT_REASON_LEVEL_1)[number];

export const LEVEL_1_LABELS: Record<ExitReasonLevel1, string> = {
  VOLUNTARY_ATTRACTED_AWAY: "Voluntary — attracted away",
  VOLUNTARY_DISSATISFACTION: "Voluntary — dissatisfaction",
  VOLUNTARY_PERSONAL: "Voluntary — personal",
  INVOLUNTARY_PERFORMANCE: "Involuntary — performance",
  INVOLUNTARY_CONDUCT: "Involuntary — conduct",
  INVOLUNTARY_BUSINESS: "Involuntary — business",
  CONTRACT: "Contract",
};

type Level2Code = { code: string; label: string };

/**
 * §12.3's Level 2 lists, in the artifact's own order.
 *
 * Codes are `L1-PREFIX-nn` rather than slugified labels: §13 makes the list
 * administrator-editable, and an administrator renaming "Manager relationship"
 * to "Line manager relationship" must not silently orphan every case coded
 * against it. The code is the identity; the label is display.
 */
export const EXIT_REASON_TAXONOMY: Record<ExitReasonLevel1, readonly Level2Code[]> = {
  VOLUNTARY_ATTRACTED_AWAY: [
    { code: "VAA-01", label: "Higher compensation" },
    { code: "VAA-02", label: "Better role or title" },
    { code: "VAA-03", label: "Career progression" },
    { code: "VAA-04", label: "More interesting work" },
    { code: "VAA-05", label: "Stronger employer brand" },
    { code: "VAA-06", label: "Better benefits" },
  ],
  VOLUNTARY_DISSATISFACTION: [
    { code: "VDS-01", label: "Compensation dissatisfaction" },
    { code: "VDS-02", label: "Lack of progression" },
    { code: "VDS-03", label: "Manager relationship" },
    { code: "VDS-04", label: "Team or culture" },
    { code: "VDS-05", label: "Workload or burnout" },
    { code: "VDS-06", label: "Lack of recognition" },
    { code: "VDS-07", label: "Job content mismatch" },
    { code: "VDS-08", label: "Work-life balance" },
    { code: "VDS-09", label: "Lack of learning opportunity" },
    { code: "VDS-10", label: "Organisational direction" },
  ],
  VOLUNTARY_PERSONAL: [
    { code: "VPR-01", label: "Relocation" },
    { code: "VPR-02", label: "Family circumstances" },
    { code: "VPR-03", label: "Further study" },
    { code: "VPR-04", label: "Career change out of sector" },
    { code: "VPR-05", label: "Retirement" },
  ],
  INVOLUNTARY_PERFORMANCE: [
    { code: "IPF-01", label: "Failure to meet standards" },
    { code: "IPF-02", label: "Failure to complete probation" },
    { code: "IPF-03", label: "Capability mismatch" },
  ],
  INVOLUNTARY_CONDUCT: [
    { code: "ICD-01", label: "Policy breach" },
    { code: "ICD-02", label: "Misconduct" },
    { code: "ICD-03", label: "Gross misconduct" },
    { code: "ICD-04", label: "Attendance" },
  ],
  INVOLUNTARY_BUSINESS: [
    { code: "IBS-01", label: "Restructure" },
    { code: "IBS-02", label: "Role redundancy" },
    { code: "IBS-03", label: "Project or contract end" },
    { code: "IBS-04", label: "Omanisation-driven replacement" },
  ],
  CONTRACT: [
    { code: "CTR-01", label: "Fixed-term expiry not renewed by employer" },
    { code: "CTR-02", label: "Fixed-term expiry not renewed by employee" },
    { code: "CTR-03", label: "Mutual non-renewal" },
  ],
};

const SPLIT = new Date("2023-07-31T00:00:00Z");
const EPOCH = new Date("1970-01-01T00:00:00Z");

type StatutorySeed = {
  key: string;
  value: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  note: string;
};

export const STATUTORY_SEED: StatutorySeed[] = [
  {
    key: "gratuity.preSplit.daysPerYear.initial",
    value: "15",
    effectiveFrom: EPOCH,
    effectiveTo: SPLIT,
    note: "UNVERIFIED (O1). Days of basic wage per year for the first band of service rendered before 31 Jul 2023.",
  },
  {
    key: "gratuity.preSplit.initialBandYears",
    value: "3",
    effectiveFrom: EPOCH,
    effectiveTo: SPLIT,
    note: "UNVERIFIED (O1). Length in years of that initial band, counted from the hire date.",
  },
  {
    key: "gratuity.preSplit.daysPerYear.subsequent",
    value: "30",
    effectiveFrom: EPOCH,
    effectiveTo: SPLIT,
    note: "UNVERIFIED (O1). Days per year for pre-split service beyond the initial band.",
  },
  {
    key: "gratuity.postSplit.daysPerYear",
    value: "30",
    effectiveFrom: SPLIT,
    effectiveTo: null,
    note: "UNVERIFIED (O1). One month of basic wage per year for service on/after 31 Jul 2023 (RD 52/2023).",
  },
  {
    key: "gratuity.daysInMonth",
    value: "30",
    effectiveFrom: EPOCH,
    effectiveTo: null,
    note: "UNVERIFIED (O1). Divisor converting a MONTHLY basic wage to a daily rate. C2: basic wage, never gross.",
  },
  {
    key: "settlement.paymentWindowDays",
    value: "7",
    effectiveFrom: EPOCH,
    effectiveTo: null,
    note: "UNVERIFIED (O1) — the artifact marks the statutory window VERIFY. C5 logs a breach as a compliance incident.",
  },
  {
    key: "deduction.visaCostRecovery.serviceMonthsThreshold",
    value: "24",
    effectiveFrom: EPOCH,
    effectiveTo: null,
    note: "UNVERIFIED (O1). §16.1: applies to expatriates with less than 24 months' service (T14 triggers at 18, T15 does not at 30).",
  },
];
