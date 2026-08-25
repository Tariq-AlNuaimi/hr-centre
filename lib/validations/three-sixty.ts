import { z } from "zod";

/** §9 — boundary validation for the 360 module. */

const text = (field: string, max = 2000) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be ${max} chars or fewer`);

export const createThreeSixtyCycleSchema = z
  .object({
    cycleId: z.string().min(1),
    opensAt: z.coerce.date(),
    deadline: z.coerce.date(),
    templates: z
      .array(
        z.object({
          type: z.enum(["LINE_MANAGER_TO_EMPLOYEE", "EMPLOYEE_TO_LINE_MANAGER", "PEER_TO_PEER"]),
          questions: z
            .array(
              z.object({
                text: text("A question"),
                // §9.2 — "scored questions PLUS open-ended feedback questions".
                scored: z.boolean().default(true),
              }),
            )
            .min(1, "A template needs at least one question")
            .max(60, "A template may hold at most 60 questions"),
        }),
      )
      // §9.2 — three types, each with its own template.
      .length(3, "§9.2 requires a template for each of the three assessment types"),
  })
  .refine((v) => v.deadline > v.opensAt, {
    path: ["deadline"],
    message: "The deadline must fall after the cycle opens",
  })
  .refine((v) => new Set(v.templates.map((t) => t.type)).size === 3, {
    path: ["templates"],
    message: "Each assessment type may appear once",
  });

/** §9.6 — HR reviews and EDITS assignments before launch. */
export const setAssignmentsSchema = z.object({
  threeSixtyCycleId: z.string().min(1),
  rateeId: z.string().min(1),
  raterIds: z
    .array(z.string().min(1))
    .max(10, "That is more raters than §9.4 contemplates")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "The same person cannot be assigned twice to one employee",
    }),
});

/** §9.7 — the rater filling in their form. Saving is incremental. */
export const submitResponsesSchema = z.object({
  assignmentId: z.string().min(1),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        // §9.3's forced 4-point scale. Null for an open-ended question.
        score: z.number().int().min(1).max(4).nullable().optional(),
        text: z.string().trim().max(4000).nullable().optional(),
      }),
    )
    .min(1)
    .max(60),
  /** True when the rater is finishing, false while they are still working. */
  submit: z.boolean().default(false),
});

export const activateSchema = z.object({ threeSixtyCycleId: z.string().min(1) });
