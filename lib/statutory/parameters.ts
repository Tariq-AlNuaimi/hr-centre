/**
 * Core statutory parameters (JML S1, docs/blueprints/jml.md D4) — ported
 * verbatim from HR Offboarding `lib/offboarding/statutory.ts` (US16 / AC-16.1,
 * US10 / AC-10.1). The rows live in the core `StatutoryParameter` table; this
 * module is the ONLY reader of their meaning and stays pure.
 */
/**
 * Statutory parameter lookup — US16 / AC-16.1, US10 / AC-10.1 (build-plan 5.1).
 *
 * §17.2's standing build instruction, verbatim: "Every statutory figure —
 * notice days, gratuity rates and split dates, settlement payment window,
 * retention periods — must be a configurable parameter with an effective-date
 * range, never a hard-coded value. Oman's framework has changed materially
 * since 2023 and the Social Protection savings system transition remains in
 * progress. A system with hard-coded rates becomes non-compliant on the day the
 * next ministerial decision issues, and nobody notices."
 *
 * That last clause is why this module is the ONLY reader. The blueprint's OQ7
 * mitigation — build the engine before O1/O2/O3 are answered — holds on exactly
 * one condition: **no statutory figure ever appears in code.** A single
 * hard-coded rate defeats it silently, because the worksheet still computes and
 * still looks right. Everything downstream takes its numbers from here, and
 * `resolve` reports whether the number it returned has been verified by a human
 * so AC-10.8 can watermark and block on it.
 *
 * No `prisma` import: this module is pure. The caller loads the rows (one
 * bounded query per settlement) and hands them in, which is what lets the whole
 * gratuity engine be tested without a database.
 */

/**
 * The parameter keys this system reads. A closed list, so a typo is a compile
 * error rather than a silently-missing rate that resolves to "unconfigured"
 * and blocks a settlement nobody can explain.
 */
export const STATUTORY_KEYS = [
  /** Days of basic wage accrued per year of service, for service BEFORE the
   *  split date, during the initial band. */
  "gratuity.preSplit.daysPerYear.initial",
  /** Length in years of that initial band. */
  "gratuity.preSplit.initialBandYears",
  /** Days per year for pre-split service AFTER the initial band. */
  "gratuity.preSplit.daysPerYear.subsequent",
  /** Days of basic wage per year for service AFTER the split date. */
  "gratuity.postSplit.daysPerYear",
  /** Days in the month used to convert a monthly basic wage to a daily rate. */
  "gratuity.daysInMonth",
  /** Days from Last Day of Service within which settlement must be paid (C5). */
  "settlement.paymentWindowDays",
  /**
   * Artifact open item **O2**: gratuity treatment on summary dismissal for
   * cause — "whether entitlement is affected. Legal review. NOT ASSERTED IN
   * THIS DOCUMENT."
   *
   * Deliberately NOT seeded. Its ABSENCE is the unconfigured state, and
   * `computeGratuity` throws on that branch rather than applying the standard
   * calculation to the exit most likely to be challenged (build-plan 5.3,
   * blueprint OQ7). Once legal answers O2, an administrator adds the row:
   * 1 = entitlement unaffected, 0 = forfeited, or a factor in between.
   */
  "gratuity.summaryDismissal.entitlementFactor",
  /** Months of service below which expatriate visa cost recovery applies
   *  (§16.1; T14 triggers at 18 months, T15 does not at 30). */
  "deduction.visaCostRecovery.serviceMonthsThreshold",
  /**
   * The Omanisation ratio target, as a percentage — compliance gate C8's
   * "exits moving the ratio below target alert HR Manager at the backfill
   * decision".
   *
   * Deliberately NOT seeded, for the same reason as O2 above: Omanisation
   * percentages in Oman are set per sector, this build does not know Rihal's,
   * and a target guessed here would make C8's alert either silent or wrong
   * while looking configured. Absent means R8 reports `belowTarget: null` —
   * "we do not know" — rather than `false`.
   */
  "omanisation.targetRatioPercent",
] as const;

export type StatutoryKey = (typeof STATUTORY_KEYS)[number];

export function isStatutoryKey(key: string): key is StatutoryKey {
  return (STATUTORY_KEYS as readonly string[]).includes(key);
}

export type StatutoryRow = {
  key: string;
  /** Carried as a string, not a number: the column is Decimal(18,6) precisely
   *  because these are money multipliers, and going through a JS float on the
   *  way in would discard the reason for that. Parsed once, here. */
  value: string | number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  verified: boolean;
};

export type Resolved = {
  key: StatutoryKey;
  value: number;
  /** FALSE while no human has checked this figure against the source
   *  instrument. AC-10.8 watermarks the worksheet and blocks Final Settlement
   *  Approval on it. */
  verified: boolean;
  effectiveFrom: Date;
};

export class StatutoryParameterMissingError extends Error {
  readonly status = 422;
  constructor(
    readonly key: string,
    readonly on: Date,
  ) {
    super(
      `No statutory parameter "${key}" is configured for ${on.toISOString().slice(0, 10)}. ` +
        `Configure it in Administration (§17.2: every statutory figure is a parameter with an ` +
        `effective-date range, never a value in code).`,
    );
    this.name = "StatutoryParameterMissingError";
  }
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * The row in force for `key` on `on`.
 *
 * Half-open interval: `effectiveFrom <= on < effectiveTo`, with a null
 * `effectiveTo` meaning open-ended. Half-open rather than inclusive on both
 * ends because the alternative makes the changeover day ambiguous — two rows
 * would both match 31 July 2023, and which one wins would depend on row order.
 *
 * Throws rather than defaulting when nothing matches. A missing rate that
 * silently became zero would produce a gratuity of zero on a worksheet that
 * looks complete, which is the failure this whole module exists to prevent.
 */
export function resolve(rows: readonly StatutoryRow[], key: StatutoryKey, on: Date): Resolved {
  const target = utcDay(on);

  const candidates = rows
    .filter((r) => r.key === key)
    .filter((r) => utcDay(r.effectiveFrom) <= target)
    .filter((r) => r.effectiveTo === null || target < utcDay(r.effectiveTo))
    // Latest effective row wins, so a correction superseding an earlier row is
    // a new row rather than an edit to history.
    .sort((a, b) => utcDay(b.effectiveFrom) - utcDay(a.effectiveFrom));

  const hit = candidates[0];
  if (!hit) throw new StatutoryParameterMissingError(key, on);

  const value = typeof hit.value === "number" ? hit.value : Number(hit.value);
  if (!Number.isFinite(value)) {
    throw new StatutoryParameterMissingError(key, on);
  }

  return { key, value, verified: hit.verified, effectiveFrom: hit.effectiveFrom };
}

/**
 * AC-10.8: is every parameter this settlement depended on verified?
 *
 * Takes the resolutions actually USED rather than scanning the whole table: a
 * settlement should not be blocked by an unverified retention period it never
 * read, and it must be blocked by an unverified gratuity rate it did.
 */
export function unverifiedAmong(resolutions: readonly Resolved[]): StatutoryKey[] {
  return [...new Set(resolutions.filter((r) => !r.verified).map((r) => r.key))];
}
