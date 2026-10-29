import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { isoDay } from "./config";
import { CHANGE_TYPES } from "./template";

/** Internal-change boundary (Onboarding createInternalChangeSchema; R10: never salary). */

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * QA2 N-08 — a mover's effective date within sane bounds: up to 90 days back
 * (HR catching up on a change already in force) and up to a year ahead. A 2020
 * date used to be accepted and would have rewritten the record as of six years
 * ago.
 */
export const MOVE_BACKDATE_DAYS = 90;
export const MOVE_AHEAD_DAYS = 366;
const DAY_MS = 86_400_000;
const moveEffectiveDate = isoDay.superRefine((d, ctx) => {
  if (!(d instanceof Date)) return;
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  if (d.getTime() < today - MOVE_BACKDATE_DAYS * DAY_MS) {
    ctx.addIssue({
      code: "custom",
      message: `The effective date can be at most ${MOVE_BACKDATE_DAYS} days in the past.`,
    });
  } else if (d.getTime() > today + MOVE_AHEAD_DAYS * DAY_MS) {
    ctx.addIssue({
      code: "custom",
      message: "The effective date can be at most a year ahead.",
    });
  }
});

export const createMoveSchema = z.object({
  employeeId: id,
  changeType: z.enum(CHANGE_TYPES),
  effectiveDate: moveEffectiveDate,
  newDetails: z
    .object({
      entityId: id.optional(),
      departmentId: id.nullable().optional(),
      teamId: id.nullable().optional(),
      jobTitle: text(200),
      employmentType: z.enum(CONTRACT_TYPES).nullable().optional(),
      contractTypeId: id.nullable().optional(),
      workLocation: text(120),
      managerId: id.nullable().optional(),
    })
    .strict(),
});
export type CreateMoveInput = z.infer<typeof createMoveSchema>;

export const moveEmployeeQuery = z.object({ employeeId: id });

export const employeeCodeForEmployeeSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,10}[0-9]{1,10}$/, "Letters then digits, like EMP0123"),
});
