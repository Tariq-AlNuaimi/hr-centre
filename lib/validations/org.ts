import { z } from "zod";
import { isoDate } from "./employee";

/**
 * Boundary validation for the HR Centre org structure — blueprint
 * docs/blueprints/hr-centre-foundation.md §1 (F-a).
 *
 * Company → directorate (optional, Rihal only today) → department → team. These
 * schemas only shape the request; the cross-row rules (same company, retire
 * refused while people are assigned) live in lib/org/units.ts because they need
 * the database to answer.
 */

const unitName = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(120, "Keep it under 120 characters");
const id = z.string().trim().min(1).max(64);

export const renameCompanySchema = z.object({ name: unitName });

export const createDirectorateSchema = z.object({
  name: unitName,
  entityId: id,
});

export const updateDirectorateSchema = z.object({ name: unitName });

export const createOrgDepartmentSchema = z.object({
  name: unitName,
  entityId: id,
  /** Optional: TP and CL hang departments directly off the company. */
  directorateId: id.nullable().default(null),
});

/**
 * Partial on purpose — rename, move to another directorate, or move to another
 * company are separate actions on the screen. An absent key means "unchanged";
 * `directorateId: null` means "directly under the company".
 */
export const updateOrgDepartmentSchema = z
  .object({
    name: unitName.optional(),
    entityId: id.optional(),
    directorateId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const createTeamSchema = z.object({
  name: unitName,
  departmentId: id,
});

export const updateTeamSchema = z
  .object({
    name: unitName.optional(),
    departmentId: id.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export const teamListQuerySchema = z.object({
  departmentId: id.optional(),
});

/** Unit heads (overnight item 2): which unit, and who leads it (null clears). */
const ORG_UNIT_KINDS = ["COMPANY", "DIRECTORATE", "DEPARTMENT", "TEAM"] as const;
export const setUnitHeadSchema = z.object({
  kind: z.enum(ORG_UNIT_KINDS),
  unitId: id,
  headEmployeeId: id.nullable(),
});
export type SetUnitHeadInput = z.infer<typeof setUnitHeadSchema>;

export type CreateDirectorateInput = z.infer<typeof createDirectorateSchema>;
export type CreateOrgDepartmentInput = z.infer<typeof createOrgDepartmentSchema>;
export type UpdateOrgDepartmentInput = z.infer<typeof updateOrgDepartmentSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

/**
 * P2 (UX R19) — schedule an effective-dated reorganisation step: a rename, a
 * move under a new parent, or both, from `effectiveDate` (YYYY-MM-DD).
 */
export const scheduleOrgChangeSchema = z
  .object({
    unitKind: z.enum(["DIRECTORATE", "DEPARTMENT", "TEAM"]),
    unitId: z.string().min(1).max(40),
    // QA2 N-05 — a REAL calendar day: 2026-02-30 used to roll to 2 March.
    effectiveDate: isoDate,
    /** QA2 N-05 — HR's explicit confirmation to apply a past-dated change today. */
    applyNow: z.boolean().optional(),
    newName: unitName.optional(),
    /** Present = the parent changes; null = no directorate (departments only). */
    newParentId: z.string().min(1).max(40).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => v.newName !== undefined || v.newParentId !== undefined, {
    message: "Change the name, the parent, or both.",
  })
  .refine((v) => !(v.unitKind === "DIRECTORATE" && v.newParentId !== undefined), {
    message: "newParentId: a directorate belongs to its company and cannot move.",
  })
  .refine((v) => !(v.unitKind === "TEAM" && v.newParentId === null), {
    message: "newParentId: a team always belongs to a department.",
  });
