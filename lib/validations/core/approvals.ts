import { z } from "zod";

/** Modules whose approvals can be delegated today (ADR-094). */
export const DELEGABLE_MODULES = ["hiring"] as const;

const MAX_DAYS = 90;

/** "Decide my approvals while I am away" — at most 90 days, ending after it starts. */
export const delegationSchema = z
  .object({
    delegateId: z.string().trim().min(1).max(64),
    module: z.enum(DELEGABLE_MODULES),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.validUntil > d.validFrom, {
    message: "The delegation must end after it starts.",
    path: ["validUntil"],
  })
  .refine((d) => d.validUntil.getTime() - d.validFrom.getTime() <= MAX_DAYS * 86_400_000, {
    message: `Keep a delegation to ${MAX_DAYS} days or fewer.`,
    path: ["validUntil"],
  });
