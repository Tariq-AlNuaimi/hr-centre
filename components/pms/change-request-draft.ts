import { KPI_LEVEL_FIELDS } from "@/components/pms/KpiForm";

/**
 * The shapes and the arithmetic the §6 screens share.
 *
 * Split out of `ChangeRequestComposer` so the composer, the review panel and the
 * page that hosts them agree on what a draft edit IS. It also keeps the
 * composer inside the complexity budget without inventing a seam — this file is
 * types plus one pure function, and both have more than one caller.
 */

/** A live KPI as the screens receive it: `weightage` is a decimal STRING. */
export interface ComposerKpi {
  id: string;
  description: string;
  weightage: string;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
}

/** A proposed new state, all strings — the vocabulary the inputs speak. */
export type Draft = { kpiId: string } & Omit<ComposerKpi, "id">;

/** What actually crosses the wire: only the fields that MOVED. */
export type MinimalEdit = { kpiId: string } & Partial<Omit<ComposerKpi, "id">>;

/** The seven §5.2 fields a change may touch. */
const EDITABLE = [
  "description",
  "weightage",
  ...KPI_LEVEL_FIELDS.map(({ field }) => field),
] as const;

/**
 * Reduce a fully-prefilled draft to the fields that differ from the live KPI.
 *
 * The composer prefills every field so a manager can see and edit the whole KPI,
 * but sending all seven back makes each one look changed: the stored edit has no
 * nulls, so §6.3's history reports six fields that nobody touched and HR's diff
 * shows "Delivery objective for 2099 → Delivery objective for 2099". Absence is
 * how "unchanged" is expressed end to end (`applyEdit`, the nullable columns,
 * the not-empty CHECK), so the payload has to say it by omission.
 *
 * Returns null when nothing moved — an inert edit the API refuses anyway.
 */
export function minimalEdit(live: ComposerKpi, draft: Draft): MinimalEdit | null {
  const out: MinimalEdit = { kpiId: draft.kpiId };
  let moved = false;
  for (const field of EDITABLE) {
    if (draft[field] !== live[field]) {
      out[field] = draft[field];
      moved = true;
    }
  }
  return moved ? out : null;
}

/** Textarea styling, matching `KpiForm`'s so the two authoring surfaces look alike. */
export const TEXTAREA_CLASS =
  "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm " +
  "text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * §5.3's total for the set as it WOULD be — in exact decimal arithmetic, done on
 * scaled integers rather than floats.
 *
 * `Number` would be the obvious choice and is the wrong one: the comparison is
 * against exactly 100, and 33.33 + 33.33 + 33.34 in IEEE-754 is
 * 100.00000000000001. A manager who had balanced the set correctly would see the
 * badge refuse it. Weightages are `Decimal(5,2)`, so two decimal places is the
 * whole domain — scaling by 100 makes every value an integer and the sum exact.
 *
 * Returns a plain string so the caller compares against `"100"` and never
 * against a float. A malformed entry mid-typing yields `null`, which reads as
 * "not balanced" without pretending to know a total.
 */
export function proposedTotal(kpis: ComposerKpi[], drafts: Record<string, Draft>): string {
  let cents = 0;
  for (const kpi of kpis) {
    const raw = (drafts[kpi.id]?.weightage ?? kpi.weightage).trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return "—";
    const [whole, frac = ""] = raw.split(".");
    cents += Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const frac = abs % 100;
  return frac === 0
    ? `${sign}${Math.floor(abs / 100)}`
    : `${sign}${Math.floor(abs / 100)}.${String(frac).padStart(2, "0")}`;
}

export { KPI_LEVEL_FIELDS };
