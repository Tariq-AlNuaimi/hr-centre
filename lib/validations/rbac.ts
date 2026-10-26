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

/**
 * Every scope an assignment may carry: the org kinds plus HR tickets' HR Tag
 * pair kinds (HIVE port). `OWN_HR_PAIR` is resolved per request from the
 * holder's HR Tag member link, so like GROUP it names no unit.
 */
export const SCOPE_TYPES = [...ORG_SCOPE_TYPES, "HR_PAIR", "OWN_HR_PAIR"] as const;
export type ScopeTypeCode = (typeof SCOPE_TYPES)[number];

/** Scopes that name no unit (`scopeId` must be null). */
export const UNITLESS_SCOPES: ReadonlySet<string> = new Set(["GROUP", "OWN_HR_PAIR"]);

const instant = z.iso
  .datetime({ offset: true, message: "Use an ISO date-time" })
  .transform((v) => new Date(v));

export const assignmentBodySchema = z
  .object({
    userId: z.string().trim().min(1, "Choose a person"),
    roleId: z.string().trim().min(1, "Choose a role"),
    scopeType: z.enum(SCOPE_TYPES),
    scopeId: z.string().trim().min(1).max(64).nullable().default(null),
    validFrom: instant.nullable().default(null),
    validUntil: instant.nullable().default(null),
    note: z.string().trim().max(300, "Keep it under 300 characters").nullable().default(null),
  })
  .refine((v) => UNITLESS_SCOPES.has(v.scopeType) === (v.scopeId === null), {
    message: "Group and own HR pair need no unit; every other scope needs one",
    path: ["scopeId"],
  });

export type RoleBody = z.infer<typeof roleBodySchema>;
export type AssignmentBody = z.infer<typeof assignmentBodySchema>;
