import { totalMonthlyComp } from "./approval-chain";

/**
 * The offer's package as a reader sees it, and what a revision changes —
 * pure (Interview Hub `lib/services/offer-package.ts`). Callers pass figures
 * that have ALREADY been through the comp gate; a redacted offer gives an
 * empty breakdown, which the UI shows as "Restricted", never as "nothing".
 */

export const ALLOWANCE_KEYS = [
  "housing",
  "transport",
  "car",
  "fuel",
  "phone",
  "education",
  "other",
] as const;
const ORDER = ["housing", "transport", "transportation"];

type CompRow = { key: string; amount: number; basic?: boolean };
export type CompBreakdown = {
  rows: CompRow[];
  basic: number | null;
  allowanceTotal: number;
  totalMonthly: number | null;
};

export function buildCompBreakdown(
  salary: number | null | undefined,
  allowances: unknown,
): CompBreakdown {
  const rows: CompRow[] = [];
  const basic = typeof salary === "number" && Number.isFinite(salary) ? salary : null;
  if (basic !== null) rows.push({ key: "basic", amount: basic, basic: true });
  const map =
    allowances && typeof allowances === "object" && !Array.isArray(allowances)
      ? (allowances as Record<string, unknown>)
      : {};
  const entries = Object.entries(map)
    .map(([key, v]) => ({ key, amount: typeof v === "number" ? v : Number(v) }))
    .filter((e) => Number.isFinite(e.amount) && e.amount > 0)
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  let allowanceTotal = 0;
  for (const e of entries) {
    allowanceTotal += e.amount;
    rows.push(e);
  }
  return { rows, basic, allowanceTotal, totalMonthly: totalMonthlyComp(basic, map) };
}

const rank = (k: string) => {
  const i = ORDER.indexOf(k.toLowerCase());
  return i === -1 ? 99 : i;
};

export type BandStatus = "WITHIN" | "BELOW" | "ABOVE" | "NO_BAND" | "NO_SALARY";

/** Basic (not total) against the requisition's basic band; never "within" unverified. */
export function bandVerdict(
  basic: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): BandStatus {
  const hasMin = typeof min === "number" && Number.isFinite(min);
  const hasMax = typeof max === "number" && Number.isFinite(max);
  if (typeof basic !== "number" || !Number.isFinite(basic)) return "NO_SALARY";
  if (!hasMin && !hasMax) return "NO_BAND";
  if (hasMin && basic < (min as number)) return "BELOW";
  if (hasMax && basic > (max as number)) return "ABOVE";
  return "WITHIN";
}

export type OfferTerms = {
  salary?: number | null;
  allowances?: Record<string, number> | null;
  startDate?: string | null;
  probationMonths?: number | null;
  noticePeriod?: string | null;
  contractType?: string | null;
  benefits?: string | null;
};
export type OfferTermField = keyof OfferTerms;

/** Moving the money voids the approvals; moving logistics does not. */
const APPROVAL_RESTARTING_FIELDS = ["salary", "allowances"] as const;

function sameAllowances(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    const m = v && typeof v === "object" ? (v as Record<string, number>) : {};
    return JSON.stringify(
      Object.keys(m)
        .filter((k) => Number(m[k]) > 0)
        .sort()
        .map((k) => [k, Number(m[k])]),
    );
  };
  return norm(a) === norm(b);
}

const MUSCAT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Muscat",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function sameValue(field: OfferTermField, a: unknown, b: unknown): boolean {
  if (field === "startDate") {
    // A date-only term: the same calendar day in Muscat is the same date, whatever the time part.
    const d = (v: unknown) => (v == null ? null : MUSCAT_DAY.format(new Date(v as string)));
    return d(a) === d(b);
  }
  if (field === "salary") return (a == null ? null : Number(a)) === (b == null ? null : Number(b));
  if (field === "allowances") return sameAllowances(a, b);
  return (a ?? null) === (b ?? null);
}

/** PATCH semantics: a field absent from `patch` is not being changed. */
export function diffOfferTerms(prev: OfferTerms, patch: OfferTerms): OfferTermField[] {
  return (Object.keys(patch) as OfferTermField[]).filter(
    (f) => patch[f] !== undefined && !sameValue(f, patch[f], prev[f]),
  );
}

export function restartsApproval(changed: readonly string[]): boolean {
  return changed.some((f) => (APPROVAL_RESTARTING_FIELDS as readonly string[]).includes(f));
}

const FIELD_LABELS: Record<string, string> = {
  salary: "Basic salary",
  allowances: "Allowances",
  startDate: "Start date",
  probationMonths: "Probation",
  noticePeriod: "Notice period",
  contractType: "Contract type",
  benefits: "Benefits",
};

function listOf(fields: readonly string[]): string {
  const l = fields.map((f) => FIELD_LABELS[f] ?? f);
  return l.length === 1 ? l[0] : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}

/** Figure-free stored summary of a version ("Start date revised"). */
export function summarizeVersion(versionNumber: number, changed: readonly string[]): string {
  if (versionNumber <= 1) return "Extended — original offer";
  if (changed.length === 0) return "Re-sent — terms unchanged";
  return `${listOf(changed)} revised`;
}

export function nextVersionNumber(versions: readonly { versionNumber: number }[]): number {
  return versions.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1;
}

/** Oldest first; exactly one (the highest number) is current. */
export function withSupersession<T extends { versionNumber: number }>(
  versions: readonly T[],
): (T & { current: boolean })[] {
  const top = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
  return [...versions]
    .sort((a, b) => a.versionNumber - b.versionNumber)
    .map((v) => ({ ...v, current: v.versionNumber === top }));
}
