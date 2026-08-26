import { z } from "zod";

/** §10 / §13.2 — boundary validation for calibration and the publish gate. */

const BANDS = ["OUTSTANDING", "EXCELLENT", "TARGET", "ALMOST_ACHIEVED", "UNSATISFACTORY"] as const;
const pct = z.coerce.number().min(0).max(100);

/**
 * §10.2 — an editable target distribution across the five bands.
 *
 * The five must total 100: §10.4 shows HR "the target distribution vs. actual",
 * and a target summing to 90 makes every gap on that screen wrong by a tenth.
 * The database enforces it too.
 */
export const setTargetSchema = z
  .object({
    cycleId: z.string().min(1),
    outstandingPct: pct,
    excellentPct: pct,
    targetPct: pct,
    almostAchievedPct: pct,
    unsatisfactoryPct: pct,
    // §10.3 — "The threshold (5) is an editable setting controlled by HR Super
    // Admin." Below 2 a department has no distribution to shape at all.
    minDepartmentSize: z.coerce.number().int().min(2).max(500).default(5),
  })
  .refine(
    (v) =>
      Math.round(
        (v.outstandingPct +
          v.excellentPct +
          v.targetPct +
          v.almostAchievedPct +
          v.unsatisfactoryPct) *
          100,
      ) === 10000,
    { path: ["targetPct"], message: "§10.2: the five band percentages must total exactly 100" },
  );

/** §10.5 — an override carries a mandatory reason. */
export const adjustSchema = z.object({
  employeeScoreId: z.string().min(1),
  toBand: z.enum(BANDS),
  reason: z
    .string()
    .trim()
    .min(1, "§10.5: a calibration adjustment carries a mandatory reason")
    .max(4000),
});

/**
 * §13.2 — publish or un-publish, cycle-wide.
 *
 * `confirm` must be the literal word: "Guard against accidental triggering:
 * confirmation step + clear warning … Must be impossible to publish by a stray
 * click." A boolean would be satisfied by any truthy value a mis-wired client
 * sends; a typed word cannot arrive by accident.
 */
export const publishSchema = z
  .object({
    cycleId: z.string().min(1),
    action: z.enum(["PUBLISH", "UNPUBLISH"]),
    confirm: z.literal("CONFIRM"),
    reason: z.string().trim().max(4000).optional(),
  })
  .refine((v) => v.action !== "UNPUBLISH" || (v.reason !== undefined && v.reason.length > 0), {
    path: ["reason"],
    // §13.2 — "reversal is audited (who, when, why)". The why is not optional.
    message: "§13.2: un-publishing carries a reason",
  });
