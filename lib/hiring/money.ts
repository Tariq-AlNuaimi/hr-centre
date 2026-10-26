/**
 * Money helpers (Interview Hub `lib/currency.ts`). OMR is the base and reporting
 * currency; a band may be entered in another currency and is converted with
 * static, conservative rates (no live FX — outbound FX APIs are not reachable
 * and bands do not need intraday precision). Pure and client-safe.
 */

export const CURRENCY_CODES = [
  "OMR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "INR",
  "EGP",
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** OMR per 1 unit of the currency. */
const RATES_TO_OMR: Record<CurrencyCode, number> = {
  OMR: 1,
  USD: 0.385,
  EUR: 0.42,
  GBP: 0.49,
  AED: 0.105,
  SAR: 0.103,
  QAR: 0.106,
  KWD: 1.25,
  BHD: 1.021,
  INR: 0.0046,
  EGP: 0.008,
};

/** Decimal / string / number → finite number or null (never NaN). */
export function toNum(
  v: { toNumber(): number } | number | string | null | undefined,
): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = typeof v === "string" ? Number(v) : v.toNumber();
  return Number.isFinite(n) ? n : null;
}

/** Convert to OMR; an unknown currency is returned unchanged. */
export function toOMR(amount: number, currency: string): number {
  const rate = (RATES_TO_OMR as Record<string, number | undefined>)[currency];
  return rate === undefined ? amount : amount * rate;
}

/** Null-preserving: no band means "absent", never 0. */
export function toOMRorNull(
  amount: { toNumber(): number } | number | string | null | undefined,
  currency: string,
): number | null {
  const n = toNum(amount);
  return n === null ? null : toOMR(n, currency);
}

/** "1,500 OMR"; non-OMR also shows "(≈ 578 OMR)". "—" for nothing. */
export function formatMoney(amount: number | null | undefined, currency = "OMR"): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const native = `${amount.toLocaleString("en-US")} ${currency}`;
  if (currency === "OMR") return native;
  return `${native} (≈ ${Math.round(toOMR(amount, currency)).toLocaleString("en-US")} OMR)`;
}

/** "1,000–1,500 OMR" with the OMR equivalent for another currency. */
export function formatBand(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "OMR",
): string {
  const has = (n: number | null | undefined): n is number =>
    typeof n === "number" && !Number.isNaN(n);
  if (!has(min) && !has(max)) return "—";
  const f = (n: number | null | undefined) => (has(n) ? n.toLocaleString("en-US") : "—");
  const native = `${f(min)}–${f(max)} ${currency}`;
  if (currency === "OMR") return native;
  const o = (n: number | null | undefined) => (has(n) ? Math.round(toOMR(n, currency)) : null);
  return `${native} (≈ ${f(o(min))}–${f(o(max))} OMR)`;
}
