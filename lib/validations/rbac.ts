import { z } from "zod";
import { PERMISSION_CODES } from "@/lib/rbac/catalogue";

/**
 * Boundary validation for the role builder and assignments — blueprint §3 (F-c).
 * Permissions are checked against the code catalogue: a role cannot hold an
 * action no route enforces.
 */

const permission = z.enum(PERMISSION_CODES as [string, ...string[]], {
  message: "Not a permission in the catalogue",
});

export const roleBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Keep it under 80 characters"),
  description: z
    .string()
    .trim()
    .max(300, "Keep it under 300 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  permissions: z
    .array(permission)
    .min(1, "Tick at least one action")
    .transform((list) => [...new Set(list)].sort()),
});

export const ORG_SCOPE_TYPES = ["GROUP", "COMPANY", "DIRECTORATE", "DEPARTMENT"] as const;

const instant = z.iso
  .datetime({ offset: true, message: "Use an ISO date-time" })
  .transform((v) => new Date(v));

export const assignmentBodySchema = z
  .object({
    userId: z.string().trim().min(1, "Choose a person"),
    roleId: z.string().trim().min(1, "Choose a role"),
    scopeType: z.enum(ORG_SCOPE_TYPES),
    scopeId: z.string().trim().min(1).max(64).nullable().default(null),
    validFrom: instant.nullable().default(null),
    validUntil: instant.nullable().default(null),
    note: z.string().trim().max(300, "Keep it under 300 characters").nullable().default(null),
  })
  .refine((v) => (v.scopeType === "GROUP") === (v.scopeId === null), {
    message: "Group needs no unit; every other scope needs one",
    path: ["scopeId"],
  });

export type RoleBody = z.infer<typeof roleBodySchema>;
export type AssignmentBody = z.infer<typeof assignmentBodySchema>;
