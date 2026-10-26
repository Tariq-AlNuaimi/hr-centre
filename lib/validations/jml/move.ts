import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { isoDay } from "./config";
import { CHANGE_TYPES } from "./template";

/** Internal-change boundary (Onboarding createInternalChangeSchema; R10: never salary). */

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const createMoveSchema = z.object({
  employeeId: id,
  changeType: z.enum(CHANGE_TYPES),
  effectiveDate: isoDay,
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
