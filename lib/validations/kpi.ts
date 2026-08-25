import { z } from "zod";

/**
 * Boundary validation for KPIs — spec §5.2.
 *
 * §5.2 lists six texts the manager authors: the description and one descriptor
 * per level. All six are required and none may be whitespace — the database
 * enforces that too (`kpis_texts_not_blank_check`), because a KPI whose
 * "Outstanding" is blank reaches the employee as an unlabelled rating scale.
 */

const requiredText = (field: string, max = 2000) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be ${max} characters or fewer`);

/**
 * The editable fields, WITHOUT defaults.
 *
 * Defaults live on the create schema only, and deliberately: `z.object({...})
 * .partial()` does NOT strip a `.default()`, so a field with one is still
 * produced on a partial parse. Building the update schema from a defaulted
 * shape made `safeParse({})` succeed with `{ orderIndex: 0 }` — which meant a
 * manager editing a KPI's wording silently moved it to the top of their list,
 * and the "Nothing to update" guard could never fire. Caught in review; pinned
 * by tests in tests/contracts/pms-weightage.test.ts.
 */
const kpiFields = {
  description: requiredText("KPI description"),
  // Percent with two decimals, matching Decimal(5,2) in the schema. The
  // exactly-100% rule is a SET-level check at sign-off (§5.3, lib/pms/kpi.ts) —
  // a single KPI at 40% is perfectly valid while a draft is in progress.
  weightage: z.coerce
    .number()
    .min(0, "Weightage cannot be negative")
    .max(100, "A single KPI cannot exceed 100%")
    .refine((n) => Number.isFinite(n) && Math.round(n * 100) === n * 100, {
      message: "Weightage may have at most two decimal places",
    }),
  descriptorOutstanding: requiredText("The Outstanding descriptor"),
  descriptorExcellent: requiredText("The Excellent descriptor"),
  descriptorTarget: requiredText("The Target descriptor"),
  descriptorAlmostAchieved: requiredText("The Almost Achieved descriptor"),
  descriptorUnsatisfactory: requiredText("The Unsatisfactory descriptor"),
  orderIndex: z.number().int().min(0).max(999),
};

/** Create: every field required, position defaulting to the top of the list. */
export const kpiInputSchema = z.object({
  ...kpiFields,
  orderIndex: kpiFields.orderIndex.default(0),
});

export const createKpiSchema = kpiInputSchema.extend({
  participantId: z.string().min(1),
  /**
   * §12.3 — which portion of a split year this KPI belongs to.
   *
   * Omitted by every ordinary caller, and that is the correct default: an
   * unsplit year has one set covering the whole cycle. Required only when the
   * employee HAS periods, which the route checks — the boundary cannot know.
   */
  assignmentPeriodId: z.string().min(1).nullable().optional(),
});

/**
 * Update: built from the undefaulted shape, so an omitted field stays omitted
 * and an empty body is genuinely empty.
 */
export const updateKpiSchema = z
  .object(kpiFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type KpiInput = z.infer<typeof kpiInputSchema>;
