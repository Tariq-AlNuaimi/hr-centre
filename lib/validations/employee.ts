import { z } from "zod";
import { emailSchema } from "./common";

/**
 * Boundary validation for PMS org data — spec §1.2, §1.3, §3.3.
 *
 * These schemas guard the hand-editing paths (HR fixing one record in the UI).
 * The import layer has its own validator (lib/pms/import/validate.ts) because it
 * answers a different question: import must REPORT every failure across a whole
 * file so HR can fix the sheet in one pass, whereas a form submission rejects on
 * the first problem and shows it against the field. Same rules, two shapes.
 */

export const ROLE_TRACKS = ["C_LEVEL", "DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"] as const;
export const EMPLOYEE_STATUSES = ["ACTIVE", "LEAVER"] as const;
export const PMS_ROLES = ["HR_SUPER_ADMIN", "HRBP", "EXECUTIVE_VIEWER"] as const;

/** ISO calendar day. Strict, for the reason given in import/validate.ts. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "Not a real calendar date");

/**
 * Money as a decimal STRING, never a JS number.
 *
 * §11.3 multiplies this by a band coefficient and §11.4 pro-rates it over days.
 * Binary floating point has no business in that chain, and a number that has
 * been through JSON has already lost the argument.
 */
const salary = z
  .string()
  .regex(/^\d+(\.\d{1,3})?$/, "Enter an amount like 1500 or 1500.500")
  .nullable();

const employeeCore = {
  odooId: z.string().trim().min(1, "Employee ID is required").max(64),
  name: z.string().trim().min(1, "Name is required").max(255),
  email: emailSchema,
  /**
   * §3.3 — a required employee field, and the one the whole of §11 hangs off:
   * "Anchor for 6-month eligibility gate, pro-ration Work Days, and effective
   * service". §11.7 refuses to compute a bonus without it rather than guessing.
   *
   * NULLABLE even so, and deliberately. The column was added after Phase 1 and
   * was not backfilled (migration 20260825210000) — every employee imported
   * before it carries null, meaning "not on file". Requiring it here would make
   * this form refuse to open the very records that need fixing: HR could not
   * correct a name on an employee whose joining date was never captured. Null in,
   * null out; §11 goes on flagging it until someone fills it in.
   */
  dateOfJoining: isoDate.nullable().default(null),
  departmentId: z.string().trim().min(1).nullable(),
  entityId: z.string().trim().min(1, "Entity is required"),
  managerId: z.string().trim().min(1).nullable(),
  roleTrack: z.enum(ROLE_TRACKS),
  pmsRoles: z.array(z.enum(PMS_ROLES)).max(3).default([]),
  basicSalary: salary.default(null),
  status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
  lastWorkingDay: isoDate.nullable().default(null),
  unpaidLeaveDays: z.number().int().min(0).max(366).default(0),
};

/**
 * The §1.2 exclusive-or and its siblings, expressed once and reused by create
 * and update.
 *
 * Also enforced as database CHECK constraints (see the Phase 1 migration). Both
 * on purpose: the constraint is the backstop that holds for every writer —
 * import, seed, a hand-run SQL fix — and this is the one that can attach the
 * message to the right form field.
 */
type OrgInvariantShape = {
  roleTrack: string;
  departmentId: string | null;
  managerId: string | null;
  status: string;
  dateOfJoining: string | null;
  lastWorkingDay: string | null;
};

function applyOrgInvariants<T extends z.ZodType<OrgInvariantShape>>(schema: T) {
  return schema
    .refine((v) => v.roleTrack !== "C_LEVEL" || v.departmentId === null, {
      message: "C-Level employees are tagged to an entity directly and have no department",
      path: ["departmentId"],
    })
    .refine((v) => v.roleTrack === "C_LEVEL" || v.departmentId !== null, {
      message: "A department is required for every track except C-Level",
      path: ["departmentId"],
    })
    .refine((v) => v.roleTrack === "C_LEVEL" || v.managerId !== null, {
      message: "A manager is required for every track except C-Level",
      path: ["managerId"],
    })
    .refine(
      // §11.4 pro-rates a leaver to their last working day; without it the
      // bonus period is undefined.
      (v) => v.status !== "LEAVER" || v.lastWorkingDay !== null,
      {
        message: "A leaver needs a last working day — it sets the bonus pro-ration period",
        path: ["lastWorkingDay"],
      },
    )
    .refine(
      // Nobody leaves before they join. Mirrors the
      // `employees_joining_before_leaving_check` constraint, so the message
      // lands on a field instead of arriving as a constraint violation.
      (v) =>
        v.dateOfJoining === null ||
        v.lastWorkingDay === null ||
        v.lastWorkingDay >= v.dateOfJoining,
      {
        message: "The last working day cannot be before the date of joining",
        path: ["lastWorkingDay"],
      },
    )
    .refine(
      // A joining date far in the future is a typo, not a hire. Mirrors
      // `employees_date_of_joining_sane_check` (CURRENT_DATE + 1 year); the
      // bound is generous because a signed offer with a future start date is a
      // real thing HR records ahead of time.
      (v) => {
        if (v.dateOfJoining === null) return true;
        const limit = new Date();
        limit.setUTCFullYear(limit.getUTCFullYear() + 1);
        return v.dateOfJoining <= limit.toISOString().slice(0, 10);
      },
      {
        message: "That joining date is more than a year away — check it for a typo",
        path: ["dateOfJoining"],
      },
    );
}

export const createEmployeeSchema = applyOrgInvariants(z.object(employeeCore));

/**
 * §3.2 — `odooId` is absent from the update shape on purpose. It is the
 * permanent key every downstream record (KPIs, sign-offs, 360 assignments,
 * scores, audit entries) hangs off, and the spec says it "must never shift".
 * Correcting a mistyped ID is therefore a deliberate delete-and-recreate, not a
 * field edit someone can make in passing.
 */
const { odooId: _immutableKey, ...updatableFields } = employeeCore;

/**
 * The six fields whose DEFAULT is safe on a create and destructive on an update.
 *
 * `PUT /api/employees/[id]` replaces the whole row. On a CREATE, an absent
 * `status` reasonably means "a new employee, so ACTIVE", and an absent
 * `pmsRoles` means "no HR authority yet" — the defaults are a convenience and
 * they are right. On a full-replace UPDATE the same absence means "I forgot to
 * send it", and zod filling it in is silent data loss:
 *
 *   - `status` → ACTIVE **reactivates a leaver**, and does it without restoring
 *     the login ADR-069's off-boarding revoked — leaving an ACTIVE employee whose
 *     account is soft-deleted, which is the one state that amendment exists to
 *     prevent. This is why the risk got sharper rather than staying theoretical.
 *   - `pmsRoles` → `[]` **strips §4.1 authority** from an HR Super Admin.
 *   - `basicSalary` → null **wipes payroll** (§11.3 multiplies by it).
 *   - `unpaidLeaveDays` → 0 **wipes §11.5's** service reduction.
 *   - `dateOfJoining` → null **wipes §3.3's anchor**, and §11.7 then refuses to
 *     compute a bonus at all.
 *   - `lastWorkingDay` → null **wipes §11.4's** pro-ration period.
 *
 * Every one of those is a field a caller would never *intend* to clear by
 * omission. So on update they are REQUIRED: a missing one is a 400 naming the
 * field, not a quiet overwrite. Nullable where the column is — "send me null" is
 * a decision; "send me nothing" is a mistake.
 *
 * Nothing user-facing changes: `EmployeeEditForm` builds its payload from
 * `UpdateEmployeeInput`, so a forgotten field was already a build error there.
 * This closes the same hole at the HTTP boundary, for the second caller that does
 * not exist yet. Raised by the post-push breadth review (2026-08-26) at low
 * confidence; confirmed, and hardened on the operator's call.
 */
const updateRequiredFields = {
  ...updatableFields,
  dateOfJoining: isoDate.nullable(),
  pmsRoles: z.array(z.enum(PMS_ROLES)).max(3),
  basicSalary: salary,
  status: z.enum(EMPLOYEE_STATUSES),
  lastWorkingDay: isoDate.nullable(),
  unpaidLeaveDays: z.number().int().min(0).max(366),
};

export const updateEmployeeSchema = applyOrgInvariants(z.object(updateRequiredFields));

export const createEntitySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits and underscores (e.g. RIHAL)"),
  name: z.string().trim().min(1).max(120),
});

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  entityId: z.string().trim().min(1, "Choose the entity this department belongs to"),
});

/** List filters. Kept narrow so a caller cannot smuggle a raw column name in. */
export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  entityId: z.string().trim().max(64).optional(),
  departmentId: z.string().trim().max(64).optional(),
  roleTrack: z.enum(ROLE_TRACKS).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
