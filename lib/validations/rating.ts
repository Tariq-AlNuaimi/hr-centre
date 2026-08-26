import { z } from "zod";

/**
 * Boundary validation for §7.1 year-end ratings.
 *
 * `level` is an INTEGER 1–5 (§8.1), not a free number: the five levels are the
 * five descriptors the manager authored at goal-setting, so 3.5 does not name
 * anything a person could have chosen. The database CHECK-constrains the same
 * range, because a form rule is bypassable by every other writer.
 *
 * `comment` is optional HERE and conditionally required in the domain seam — the
 * rule is "required when the manager diverges from the employee", which is a
 * comparison against another row and cannot be expressed in this schema.
 * `lib/pms/rating.ts` owns it; see `divergenceBlockedReason`.
 */

export const ratingLevelSchema = z
  .number()
  .int("A rating must be one of the five levels")
  .min(1, "The lowest level is 1 (Unsatisfactory)")
  .max(5, "The highest level is 5 (Outstanding)");

export const upsertRatingSchema = z.object({
  kpiId: z.string().min(1),
  party: z.enum(["EMPLOYEE", "MANAGER"]),
  level: ratingLevelSchema,
  comment: z
    .string()
    .trim()
    .max(4000, "A comment must be 4000 characters or fewer")
    .optional()
    // An empty box is ABSENT, not blank: the column is nullable to mean "nothing
    // said", and "" would be a comment nobody wrote. The database refuses a
    // blank-but-present string for the same reason.
    .transform((v) => (v === undefined || v === "" ? undefined : v)),
});

export const yearEndSignOffSchema = z.object({
  participantId: z.string().min(1),
  party: z.enum(["EMPLOYEE", "MANAGER"]),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;
