import { z } from "zod";

/**
 * §8.4 — the Strategy team's Corporate and Departmental figures, keyed in by HR.
 *
 * The score is a decimal STRING on the wire for the same reason weightages are:
 * §8.6 multiplies it by a track weight and §8.7 bands the result at exact
 * boundaries, so it must not round-trip through a float on the way in.
 */

const strategyScoreValue = z
  .union([z.string().trim(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v))
  .refine((s) => /^[1-5](\.\d{1,2})?$/.test(s) || s === "5.00" || s === "5.0", {
    message: "A score is between 1.00 and 5.00, with at most two decimals",
  })
  .refine((s) => Number(s) >= 1 && Number(s) <= 5, {
    message: "A score is between 1.00 and 5.00",
  });

export const upsertEntityScoreSchema = z.object({
  cycleId: z.string().min(1),
  entityId: z.string().min(1),
  score: strategyScoreValue,
});

export const upsertDepartmentScoreSchema = z.object({
  cycleId: z.string().min(1),
  departmentId: z.string().min(1),
  score: strategyScoreValue,
});
