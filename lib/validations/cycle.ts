import { z } from "zod";

/**
 * Boundary validation for the performance cycle — spec §2, §5.4.
 *
 * These mirror the CHECK constraints in
 * `prisma/migrations/20260824180000_pms_phase2_cycle_goal_setting`. The database
 * is the thing that cannot be bypassed; this layer exists so a mis-set deadline
 * comes back as a field-level message an HR user can act on rather than as a
 * constraint violation.
 */

const STAGE_KINDS = ["GOAL_SETTING", "MID_YEAR", "YEAR_END"] as const;

/** ISO date-time, coerced to a Date and required to be a real instant. */
const instant = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
  message: "must be a valid date/time",
});

export const cycleStageSchema = z
  .object({
    kind: z.enum(STAGE_KINDS),
    opensAt: instant,
    deadline: instant,
    // §5.5's grace window. Bounded at 30 because a typo of 30 for 3 on a
    // December deadline parks HR's intervention past the cycle boundary — the
    // exact failure the 3-day default was chosen to avoid.
    graceDays: z.number().int().min(0).max(30).default(3),
  })
  .refine((s) => s.deadline > s.opensAt, {
    message: "the deadline must be after the stage opens",
    path: ["deadline"],
  });

export const createCycleSchema = z.object({
  // §2 — the performance year. Goal-setting for it happens in December of the
  // prior year, which is a scheduling fact, not a different year.
  year: z.number().int().min(2000).max(2100),
  // All three touchpoints are set together: a cycle with one deadline is a
  // half-configured year, and §2 describes the three as one cadence. DRAFT
  // exists so this can be edited before anyone is held to it.
  stages: z
    .array(cycleStageSchema)
    .length(3)
    .refine((stages) => new Set(stages.map((s) => s.kind)).size === 3, {
      message: "each of the three touchpoints must appear exactly once",
    }),
});

export const updateCycleStagesSchema = z.object({
  stages: z.array(cycleStageSchema).min(1).max(3),
});

export const cycleStatusSchema = z.object({
  // DRAFT → OPEN → CLOSED. Reopening a closed year is deliberately not offered:
  // §13's publish gate and §10's calibration both assume a year stops moving.
  status: z.enum(["OPEN", "CLOSED"]),
});

export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type CycleStageInput = z.infer<typeof cycleStageSchema>;

/**
 * §6.2 / §7.1 / §8.7 — the three clauses the spec leaves open, as HR's answers.
 *
 * `strictObject` because zod's default is to STRIP an unknown key: a client
 * posting a misspelled field would otherwise get a 200 and no change, which on
 * a policy that decides a bonus coefficient (§11.3) is the worst possible
 * failure mode. Every field optional, so a caller may set one answer without
 * restating the other two.
 */
export const cyclePolicySchema = z
  .strictObject({
    divergenceReason: z.enum(["REQUIRED", "OPTIONAL", "OFF"]).optional(),
    roundScoreBeforeBanding: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Send at least one policy field to change.",
  });

export type CyclePolicyInput = z.infer<typeof cyclePolicySchema>;
