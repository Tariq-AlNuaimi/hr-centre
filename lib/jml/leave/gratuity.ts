import {
  resolve,
  unverifiedAmong,
  type Resolved,
  type StatutoryKey,
  type StatutoryRow,
} from "@/lib/statutory/parameters";

/**
 * Oman end-of-service gratuity and the settlement arithmetic — HR Offboarding
 * `settlement.ts` + `deductions.ts`, ported EXACTLY (the agreed conventions and
 * the T11–T13 hand calculations are contract tests). Pure.
 *
 * Conventions (agreed with HR, unchanged):
 *  1. service days are INCLUSIVE of both ends; years = days / 365;
 *  2. the split is HALF-OPEN — service before the split date is pre-split, the
 *     split day itself is post-split; the split date is where the post-split
 *     rule's parameter starts (RD 52/2023), never a constant;
 *  3. the initial band is counted from the HIRE date, on pre-split service only;
 *  4. daily rate = monthly BASIC / `gratuity.daysInMonth`; money rounds to baisa
 *     (3 dp) per line, and the total is the sum of the ROUNDED lines.
 *
 * F14 fixed: the summary-dismissal factor (O2) is resolved effective-dated on
 * the last day of service and an unverified factor makes the result provisional.
 */

const DAY_MS = 86_400_000;
const SPLIT_KEY: StatutoryKey = "gratuity.postSplit.daysPerYear";
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const inclusiveDays = (from: Date, to: Date) =>
  Math.round((utcDay(to) - utcDay(from)) / DAY_MS) + 1;
export const money = (n: number) => Math.round(n * 1000) / 1000;

export class GratuityUnavailableError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "GratuityUnavailableError";
  }
}

export const SUMMARY_DISMISSAL_UNCONFIGURED =
  "Gratuity treatment on summary dismissal for cause is not configured (artifact open item O2). " +
  "The artifact does not assert whether entitlement is affected, and legal review owns that " +
  "decision — so this settlement is refused rather than calculated on an assumption. " +
  'Once O2 is answered, configure "gratuity.summaryDismissal.entitlementFactor" in ' +
  "Administration (1 = unaffected, 0 = forfeited) and re-run.";

export type GratuityInput = {
  hireDate: Date;
  lastDayOfService: Date;
  /** MONTHLY BASIC wage. C2: basic, never gross. */
  basicMonthly: number;
  exitType: string;
};

export type GratuityResult = {
  serviceDays: number;
  preSplitDays: number;
  postSplitDays: number;
  preSplitEntitlementDays: number;
  postSplitEntitlementDays: number;
  dailyRate: number;
  preSplitAmount: number;
  postSplitAmount: number;
  total: number;
  unverifiedParameters: string[];
  provisional: boolean;
  dismissalEntitlementFactor: number;
};

function splitDateFrom(rows: readonly StatutoryRow[]): number {
  const post = rows
    .filter((r) => r.key === SPLIT_KEY)
    .sort((a, b) => utcDay(a.effectiveFrom) - utcDay(b.effectiveFrom))[0];
  if (!post) {
    throw new GratuityUnavailableError(
      `No "${SPLIT_KEY}" parameter is configured, so the 31 Jul 2023 service split cannot be located. ` +
        `Configure it in Administration.`,
    );
  }
  return utcDay(post.effectiveFrom);
}

function checkInput(input: GratuityInput) {
  if (utcDay(input.lastDayOfService) < utcDay(input.hireDate)) {
    throw new GratuityUnavailableError(
      "The Last Day of Service is before the hire date, so no period of service exists to calculate on.",
    );
  }
  if (!(input.basicMonthly > 0) || !Number.isFinite(input.basicMonthly)) {
    throw new GratuityUnavailableError(
      "A positive monthly BASIC wage is required to calculate gratuity (C2: basic wage, never gross). " +
        "Zeroing it would produce a settlement of zero that looks calculated.",
    );
  }
}

function dismissalFactor(
  input: GratuityInput,
  rows: readonly StatutoryRow[],
  used: Resolved[],
): number {
  if (input.exitType !== "SUMMARY_DISMISSAL") return 1;
  if (!rows.some((r) => r.key === "gratuity.summaryDismissal.entitlementFactor")) {
    throw new GratuityUnavailableError(SUMMARY_DISMISSAL_UNCONFIGURED);
  }
  let r: Resolved;
  try {
    r = resolve(rows, "gratuity.summaryDismissal.entitlementFactor", input.lastDayOfService);
  } catch {
    throw new GratuityUnavailableError(SUMMARY_DISMISSAL_UNCONFIGURED);
  }
  if (r.value < 0 || r.value > 1) {
    throw new GratuityUnavailableError(
      `"gratuity.summaryDismissal.entitlementFactor" is configured as ${r.value}; ` +
        "it must be a factor between 0 (forfeited) and 1 (unaffected).",
    );
  }
  used.push(r);
  return r.value;
}

export function computeGratuity(
  input: GratuityInput,
  rows: readonly StatutoryRow[],
): GratuityResult {
  checkInput(input);
  const used: Resolved[] = [];
  const need = (key: StatutoryKey, on: Date) => {
    const r = resolve(rows, key, on);
    used.push(r);
    return r.value;
  };
  // Refuse the O2 branch BEFORE any arithmetic (build-plan 5.3).
  const factor = dismissalFactor(input, rows, used);
  const hire = utcDay(input.hireDate);
  const lds = utcDay(input.lastDayOfService);
  const split = splitDateFrom(rows);
  const serviceDays = inclusiveDays(input.hireDate, input.lastDayOfService);
  const preSplitDays =
    lds < split ? serviceDays : hire >= split ? 0 : Math.round((split - hire) / DAY_MS);
  const postSplitDays = serviceDays - preSplitDays;
  const YEAR_DAYS = 365;
  const preYears = preSplitDays / YEAR_DAYS;
  const postYears = postSplitDays / YEAR_DAYS;

  let preSplitEntitlementDays = 0;
  if (preSplitDays > 0) {
    const dayBeforeSplit = new Date(split - DAY_MS);
    const bandYears = need("gratuity.preSplit.initialBandYears", dayBeforeSplit);
    const initialRate = need("gratuity.preSplit.daysPerYear.initial", dayBeforeSplit);
    const subsequentRate = need("gratuity.preSplit.daysPerYear.subsequent", dayBeforeSplit);
    preSplitEntitlementDays =
      Math.min(preYears, bandYears) * initialRate +
      Math.max(0, preYears - bandYears) * subsequentRate;
  }
  let postSplitEntitlementDays = 0;
  if (postSplitDays > 0) {
    postSplitEntitlementDays =
      postYears * need("gratuity.postSplit.daysPerYear", input.lastDayOfService);
  }
  const daysInMonth = need("gratuity.daysInMonth", input.lastDayOfService);
  if (!(daysInMonth > 0)) {
    throw new GratuityUnavailableError(
      `"gratuity.daysInMonth" is configured as ${daysInMonth}; a daily rate cannot be derived from it.`,
    );
  }
  const dailyRate = input.basicMonthly / daysInMonth;
  const preSplitAmount = money(preSplitEntitlementDays * dailyRate * factor);
  const postSplitAmount = money(postSplitEntitlementDays * dailyRate * factor);
  const unverifiedParameters = unverifiedAmong(used);
  return {
    serviceDays,
    preSplitDays,
    postSplitDays,
    preSplitEntitlementDays,
    postSplitEntitlementDays,
    dailyRate,
    preSplitAmount,
    postSplitAmount,
    total: money(preSplitAmount + postSplitAmount),
    unverifiedParameters,
    provisional: unverifiedParameters.length > 0,
    dismissalEntitlementFactor: factor,
  };
}

// --- AC-10.4 / C3: leave at the last day of service ---------------------------

export type LeaveResult =
  | { kind: "ENCASHMENT"; days: number; amount: number }
  | { kind: "DEDUCTION"; days: number; amount: number; requiresReference: true }
  | { kind: "NONE" };

/** §16.1: the balance at the Last Day of Service; negative = leave taken in excess (T16). */
export function computeLeave(
  input: { balanceDaysAtLastDayOfService: number; basicMonthly: number },
  rows: readonly StatutoryRow[],
  on: Date,
): LeaveResult {
  const daily = input.basicMonthly / resolve(rows, "gratuity.daysInMonth", on).value;
  const days = input.balanceDaysAtLastDayOfService;
  if (days === 0) return { kind: "NONE" };
  if (days > 0) return { kind: "ENCASHMENT", days, amount: money(days * daily) };
  return {
    kind: "DEDUCTION",
    days: Math.abs(days),
    amount: money(Math.abs(days) * daily),
    requiresReference: true,
  };
}

// --- §16.1 deductions -------------------------------------------------------

export const DEDUCTION_TYPES = {
  VISA_COST_RECOVERY: {
    label: "Visa cost recovery",
    rule: "Applies to expatriate employees with less than the configured months of service",
    referenceKind: "Contract clause",
  },
  MEDICAL_INSURANCE: {
    label: "Medical insurance",
    rule: "Pro-rated from the resignation date",
    referenceKind: "Policy period",
  },
  NEGATIVE_LEAVE_BALANCE: {
    label: "Negative leave balance",
    rule: "Leave taken in excess of accrual",
    referenceKind: "Leave record",
  },
  NOTICE_SHORTFALL: {
    label: "Notice shortfall",
    rule: "Pay in lieu where notice is not served and not covered by approved leave",
    referenceKind: "Approval record",
  },
  UNRETURNED_OR_DAMAGED_ASSET: {
    label: "Unreturned or damaged asset",
    rule: "Value from the asset register",
    referenceKind: "Asset record",
  },
  OUTSTANDING_ADVANCE_OR_LOAN: {
    label: "Outstanding advances or loans",
    rule: "Finance balance",
    referenceKind: "Finance record",
  },
} as const;

export type DeductionTypeKey = keyof typeof DEDUCTION_TYPES;

export type SettlementLineInput = {
  lineType: "ADDITION" | "DEDUCTION";
  deductionType: string | null;
  lineAmount: number | null;
  reasonCode: string | null;
  documentaryReference: string | null;
  authorisedById: string | null;
};

/** C4 / AC-10.5 / BR-OFF-014: every problem with a line, collected. */
export function settlementLineProblems(line: SettlementLineInput): string[] {
  const out: string[] = [];
  const isType = line.deductionType !== null && line.deductionType in DEDUCTION_TYPES;
  if (line.lineType === "DEDUCTION" && !isType) {
    out.push(`"${line.deductionType ?? ""}" is not one of the six §16.1 deduction types.`);
  }
  if (line.lineType === "ADDITION" && line.deductionType)
    out.push("An addition has no deduction type.");
  if (line.lineAmount === null || !(line.lineAmount > 0))
    out.push("A positive amount is required.");
  if (!line.reasonCode?.trim()) out.push("A reason code is required (C4).");
  if (!line.documentaryReference?.trim()) {
    const kind = isType
      ? DEDUCTION_TYPES[line.deductionType as DeductionTypeKey].referenceKind
      : "documentary reference";
    out.push(
      `A ${kind.toLowerCase()} reference is required. §16.1: an unreferenced deduction is indefensible if challenged.`,
    );
  }
  if (!line.authorisedById) out.push("An authorising approver is required (C4).");
  return out;
}

/** T14 / T15: visa cost recovery applies to an expatriate with fewer than the configured months. */
export function visaCostRecoveryApplies(
  input: { nationality: string; serviceMonths: number },
  rows: readonly StatutoryRow[],
  on: Date,
): { applies: boolean; thresholdMonths: number; verified: boolean } {
  const threshold = resolve(rows, "deduction.visaCostRecovery.serviceMonthsThreshold", on);
  return {
    applies: input.nationality === "EXPATRIATE" && input.serviceMonths < threshold.value,
    thresholdMonths: threshold.value,
    verified: threshold.verified,
  };
}

/** Whole calendar months from hire to the last day of service. */
export function serviceMonths(hire: Date, lds: Date): number {
  let m =
    (lds.getUTCFullYear() - hire.getUTCFullYear()) * 12 + (lds.getUTCMonth() - hire.getUTCMonth());
  if (lds.getUTCDate() < hire.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** gross = gratuity + encashment + outstanding salary; net = gross + additions − deductions (3 dp). */
export function settlementTotals(input: {
  gratuityTotal: number;
  leaveEncashment: number;
  outstandingSalary: number;
  additions: readonly number[];
  deductions: readonly number[];
}) {
  const gross = money(input.gratuityTotal + input.leaveEncashment + input.outstandingSalary);
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  return { gross, net: money(gross + sum(input.additions) - sum(input.deductions)) };
}
