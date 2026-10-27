import { z } from "zod";

/**
 * Boundary validation for §6 mid-year change requests.
 *
 * Two things here differ from `kpi.ts`, and both are deliberate.
 *
 * **Every field is optional, and absent means UNCHANGED.** §6.2 distinguishes a
 * partial change ("descriptors/metrics only") from a full overhaul, and the
 * request body is how that distinction is expressed. `kpi.ts`'s create schema
 * requires all seven because a NEW KPI has nothing to inherit from; an edit
 * always does.
 *
 * **Weightage crosses the wire as a decimal STRING, not a number.** §5.3
 * compares the resulting set against exactly 100 and `lib/pms/change-request.ts`
 * does that arithmetic in `Prisma.Decimal`. Parsing to a JS double first and
 * back is a round trip through the one type that cannot represent 33.33, for no
 * gain — the value is never arithmetic on this side of the boundary.
 */

const editableText = (field: string, max = 2000) =>
  z
    .string()
    .trim()
    .min(1, `${field} cannot be blank`)
    .max(max, `${field} must be ${max} characters or fewer`);

/**
 * A weightage as written: up to three digits, optionally two decimals, within
 * §5.2's 0–100 bound and `Decimal(5,2)`'s shape. Numbers are accepted and
 * stringified for clients that cannot help sending JSON numbers, but the value
 * kept is always the string.
 */
const weightageString = z
  .union([z.string().trim(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v))
  .refine((s) => /^\d{1,3}(\.\d{1,2})?$/.test(s), {
    message: "Weightage must be a number with at most two decimal places",
  })
  .refine((s) => Number(s) >= 0 && Number(s) <= 100, {
    message: "A single KPI's weightage must be between 0 and 100",
  });

/**
 * One KPI's proposed new state. At least one field must actually move — an edit
 * that changes nothing is noise in §6.3's history and the database refuses it
 * too (`kpi_change_request_edits_not_empty_check`).
 */
export const changeRequestEditSchema = z
  .object({
    kpiId: z.string().min(1),
    description: editableText("The KPI description").optional(),
    weightage: weightageString.optional(),
    descriptorOutstanding: editableText("The Outstanding descriptor").optional(),
    descriptorExcellent: editableText("The Excellent descriptor").optional(),
    descriptorTarget: editableText("The Target descriptor").optional(),
    descriptorAlmostAchieved: editableText("The Almost Achieved descriptor").optional(),
    descriptorUnsatisfactory: editableText("The Unsatisfactory descriptor").optional(),
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "kpiId").length > 0, {
    message: "An edit must change at least one field",
  });

/**
 * The request itself.
 *
 * `edits` is an ARRAY because §5.3 requires the set to total exactly 100: moving
 * one weightage necessarily breaks the set, so the rebalance has to travel with
 * it and be approved as one act. `lib/pms/change-request.ts` documents why at
 * length. The 50 cap is a guard against an unbounded body, not a policy — a §5.3
 * set is a handful of KPIs.
 *
 * One edit per KPI: two edits naming the same KPI are a client bug, and picking
 * a winner silently would approve something nobody reviewed. The database keys
 * `[requestId, kpiId]` unique for the same reason.
 */
export const createChangeRequestSchema = z.object({
  participantId: z.string().min(1),
  rationale: z
    .string()
    .trim()
    .min(1, "A rationale is required — HR decides on it")
    .max(4000, "The rationale must be 4000 characters or fewer"),
  edits: z
    .array(changeRequestEditSchema)
    .min(1, "A change request must propose at least one edit")
    .max(50, "A change request may cover at most 50 KPIs")
    .refine((edits) => new Set(edits.map((e) => e.kpiId)).size === edits.length, {
      message: "Each KPI may appear at most once in a request",
    }),
});

/**
 * HR's decision — §6.2.
 *
 * The rejection reason is required HERE as well as in the database, so the
 * manager gets "a reason is required" from the form rather than a constraint
 * violation. On approval the field is optional: HR may say why they agreed, and
 * usually will not.
 */
export const decideChangeRequestSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(4000, "The reason must be 4000 characters or fewer").optional(),
    /**
     * §6.2 — HR's exception: approving a change the employee never
     * acknowledged. Its own field rather than a second meaning for `reason`,
     * which the rejection rule above already owns; one field answering two
     * mandatory-reason questions cannot be validated for either.
     */
    overrideReason: z
      .string()
      .trim()
      .max(4000, "The override reason must be 4000 characters or fewer")
      .optional(),
  })
  .refine((v) => v.decision !== "REJECT" || (v.reason !== undefined && v.reason.length > 0), {
    path: ["reason"],
    message: "A rejection must carry a reason the manager can see",
  })
  .refine((v) => v.decision !== "REJECT" || v.overrideReason === undefined, {
    path: ["overrideReason"],
    message: "A rejection changes nothing, so there is nothing to override",
  });

export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;
export type ChangeRequestEditInput = z.infer<typeof changeRequestEditSchema>;
export type DecideChangeRequestInput = z.infer<typeof decideChangeRequestSchema>;
