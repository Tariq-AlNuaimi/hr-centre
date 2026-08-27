import { z } from "zod";
import { emailSchema } from "./common";

/**
 * The platform role, as a BOOLEAN — ADR-070.
 *
 * `User.role` was offered as ADMIN / EDITOR / VIEWER, and measured against the
 * code that was a three-value costume on a binary:
 *
 *   ADMIN   → `/api/users`, `/api/recycling-bin`, `/api/audit-log`, and the
 *             sidebar entries for them.
 *   EDITOR  → NOTHING. `withEditorAuth` was defined and never called.
 *   VIEWER  → nothing.
 *
 * Every read of `User.role` in the product is `=== "ADMIN"`. So HR was asked to
 * make a three-way choice the product read as two-way, in words that appear
 * nowhere in the specification (§4.1's vocabulary is HR_SUPER_ADMIN / HRBP /
 * EXECUTIVE_VIEWER, on `Employee.pmsRoles`, and it is a separate axis by ADR-065).
 * A control that does not do what it appears to do teaches something false.
 *
 * The narrowing happens HERE, at the boundary, not only in the form. A UI-only
 * change would leave the API still accepting a value nothing honours — and the
 * API is the contract.
 *
 * The `Role` enum keeps all three values, deliberately: existing rows stay valid
 * with no migration, and anything that is not ADMIN renders identically, which
 * has always been the truth. Retiring `EDITOR` from the enum is a later cleanup
 * once no row carries it.
 */
const platformAdmin = z
  .boolean()
  .describe("Can manage logins, the recycling bin and the audit log");

/** The stored enum value a boolean maps to. One place, so the two cannot drift. */
export function roleForPlatformAdmin(isPlatformAdmin: boolean): "ADMIN" | "VIEWER" {
  return isPlatformAdmin ? "ADMIN" : "VIEWER";
}

/** And back, for reading a stored row into the form. */
export function isPlatformAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

/*
  STRICT, and that is the load-bearing half of ADR-070.
  ------------------------------------------------------------------
  zod's default is to STRIP unknown keys, which made the migration silent in the
  worst way: `POST /api/users {"role":"ADMIN"}` — the old payload, verbatim —
  returned **201** and created a VIEWER. Not a privilege escalation (the default
  fails safe), but a caller who asked for an administrator got told "created" and
  received something else. An integration script written against the old shape
  would have gone on quietly making the wrong accounts.

  This was found by POSTING the legacy payload against a running server, not by
  reading the schema. With `strictObject` the same request is a 400 that names
  `role` as unrecognized, which is what a removed field should do.
*/
export const createUserSchema = z.strictObject({
  email: emailSchema,
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
  isPlatformAdmin: platformAdmin.default(false),
});

export const updateUserSchema = z.strictObject({
  email: emailSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  password: z.string().min(8).max(128).optional(), // min 8 matches createUserSchema + the self-service route
  isPlatformAdmin: platformAdmin.optional(),
});

/** @public */
export type CreateUserInput = z.infer<typeof createUserSchema>;
/** @public */
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
