import type { Prisma } from "@/generated/prisma/client";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { canViewCompensation, type PmsActor } from "./permissions";

/**
 * The single gate on Restricted compensation data — spec §4.5 / §11.6.
 *
 * "Basic salary and computed bonus amounts are visible only to HR (Super Admin +
 * HRBP), the COO, and the Ops Director. Line managers never see salary or bonus
 * — even for their own direct reports and even in their chain view. This is a
 * field-level restriction layered on top of role visibility."
 *
 * The important word is FIELD-LEVEL. Role visibility decides WHICH employees an
 * actor can see; this decides which COLUMNS come back for the ones they can.
 * The two are independent, and a line manager legitimately sits on the wrong
 * side of the second while being on the right side of the first.
 *
 * Enforcement lives here, at the point the `select` is built, rather than in a
 * component that omits a table column or a serializer that deletes a key. The
 * difference matters: if the figure is fetched and then hidden, it is present in
 * the RSC payload, in any JSON response, in a React DevTools tree, and in
 * whatever a future caller does with the object. Selecting it only when the
 * actor is entitled to it means an unauthorised payload has nothing to leak.
 *
 * Every read path that returns employee data goes through one of these
 * builders. A hand-written `select` elsewhere is a bug.
 */

/**
 * Columns every viewer of an employee record may see. Note that `basicSalary` is
 * absent and cannot be added here — that is the point of splitting the two.
 */
const BASE_EMPLOYEE_SELECT = {
  id: true,
  odooId: true,
  name: true,
  email: true,
  roleTrack: true,
  pmsRoles: true,
  status: true,
  lastWorkingDay: true,
  unpaidLeaveDays: true,
  managerId: true,
  departmentId: true,
  entityId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

/**
 * The related names a directory row needs, so a list does not fire a query per
 * row to resolve a department or a manager name (Scalable pillar: no N+1).
 */
const RELATION_SELECT = {
  department: { select: { id: true, name: true } },
  entity: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, name: true, email: true } },
} satisfies Prisma.EmployeeSelect;

/**
 * `select` for an employee list or detail read, built from the actor's
 * capabilities. Pass the actor, not a boolean: the decision then always comes
 * from `canViewCompensation`, and a caller cannot accidentally hand it `true`.
 */
export function employeeSelect(actor: PmsActor) {
  const base = { ...BASE_EMPLOYEE_SELECT, ...RELATION_SELECT };
  if (!canViewCompensation(actor)) return base;
  // The CIPHERTEXT column (ADR-067). An unentitled actor never selects it, so
  // they do not reach the envelope, let alone the plaintext — the entitlement
  // gate is still the `select`, exactly as before, and decryption happens
  // strictly inside the branch that gate already guards.
  return { ...base, basicSalaryEnc: true };
}

/**
 * Narrow `select` for the org-chart view, which renders thousands of nodes and
 * needs none of the record detail. Carries no compensation column at all — a
 * chart has no field to show it in, so there is no capability branch to get
 * wrong.
 */
export const ORG_TREE_NODE_SELECT = {
  id: true,
  name: true,
  roleTrack: true,
  status: true,
  managerId: true,
  department: { select: { id: true, name: true } },
  entity: { select: { id: true, code: true } },
} satisfies Prisma.EmployeeSelect;

/**
 * The row shape a list endpoint returns. `basicSalary` is OPTIONAL in the type,
 * not `Decimal | null` — so TypeScript forces every consumer to handle its
 * absence, and a component cannot be written on the assumption that the field
 * is always there and merely empty. The type mirrors the access rule.
 */
export type EmployeeListRow = {
  id: string;
  odooId: string;
  name: string;
  email: string;
  roleTrack: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string; name: string };
  manager: { id: string; name: string; email: string } | null;
  /**
   * §4.1/§4.3 — the additive HR roles this person holds.
   *
   * Carried for every actor, unlike `basicSalary`. §4.5's field-level
   * restriction names salary and bonus specifically; who the HRBP is, is
   * ordinary org information — and §5.5's escalation ladder actively depends on
   * people being able to tell that HR exists and who they are. Selected in
   * Prisma since Phase 1 but dropped here until the roles screen needed it,
   * which is why an HR admin could not see the roles they were editing.
   */
  pmsRoles: string[];
  /** Present ONLY for HR and executive viewers (§4.5). */
  basicSalary?: string | null;
};

/**
 * Serialise an employee row for transport.
 *
 * `Decimal` does not survive JSON, so salary is emitted as a decimal STRING
 * rather than a JS number — `Number(4200.125)` is a float, and the moment a
 * float touches a payroll figure the rounding is no longer the finance team's
 * decision (§11.4 multiplies this by a coefficient and pro-rates it over days).
 *
 * The key is omitted entirely when the actor is not entitled to it. Not set to
 * `null`, not set to `"[redacted]"` — omitted, so `"basicSalary" in row` is
 * false and there is no placeholder for a client to misread as "no salary
 * recorded".
 */
export function serializeEmployee(row: {
  id: string;
  odooId: string;
  name: string;
  email: string;
  roleTrack: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string; name: string };
  manager: { id: string; name: string; email: string } | null;
  pmsRoles?: string[];
  basicSalaryEnc?: string | null;
}): EmployeeListRow {
  const out: EmployeeListRow = {
    id: row.id,
    odooId: row.odooId,
    name: row.name,
    email: row.email,
    roleTrack: row.roleTrack,
    status: row.status,
    managerId: row.managerId,
    department: row.department,
    entity: row.entity,
    pmsRoles: row.pmsRoles ?? [],
    manager: row.manager,
  };
  // `in` rather than a truthiness check: an entitled actor looking at an
  // employee with no salary on file must still get the key (as null), because
  // "not recorded" and "not allowed to see" are different facts and the UI
  // renders them differently.
  //
  // ADR-067: the column holds a `v1.…` envelope bound to this employee's
  // `odooId`. `decryptField` THROWS on a value it cannot open, and that is not
  // an oversight — a ciphertext that will not decrypt means a wrong key, a
  // tampered row, or a value moved from another employee, and rendering any of
  // those as a blank salary is the one outcome that hides it.
  if ("basicSalaryEnc" in row) {
    out.basicSalary =
      row.basicSalaryEnc == null ? null : decryptField(row.basicSalaryEnc, row.odooId);
  }
  return out;
}

/**
 * The two salary crossings — ADR-067's "one service function" requirement.
 *
 * Every read and every write of compensation goes through this pair, so moving
 * to a different scheme later (or to Option 4, not storing it at all) is a
 * change in one file rather than a hunt. `odooId` is the binding; passing the
 * wrong one produces a ciphertext nobody can open, which is the point.
 */
export function encryptSalary(plaintext: string | null, odooId: string): string | null {
  return plaintext === null ? null : encryptField(plaintext, odooId);
}

export function decryptSalary(envelope: string | null, odooId: string): string | null {
  return envelope === null ? null : decryptField(envelope, odooId);
}
