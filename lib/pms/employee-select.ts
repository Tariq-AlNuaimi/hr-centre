import type { Prisma } from "@/generated/prisma/client";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { readIdNumber } from "@/lib/people/id-documents";
import type { Permission } from "@/lib/rbac/catalogue";
import type { ScopeSubject } from "@/lib/rbac/grants";
import {
  actorCan,
  canViewCompensation,
  canViewIdDocuments,
  canViewPersonal,
  type PmsActor,
} from "./permissions";

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
  // §3.3 — a required employee field. Carried on the BASE select (not the
  // compensation branch): it is ordinary employment data, and §11.7's "no date
  // of joining" flag is unreadable if no screen can show whether one exists.
  dateOfJoining: true,
  roleTrack: true,
  status: true,
  lastWorkingDay: true,
  unpaidLeaveDays: true,
  managerId: true,
  departmentId: true,
  entityId: true,
  // ADR-069 — the LINK, not the login. Serialised as `loginState` below, never
  // as the id: whether this person can reach the app is org information HR needs
  // (§4.4's My Tasks and §9.7's rater invitations are addressed to someone who
  // must be able to sign in), while the `User` id itself is a platform-side
  // identifier no employee screen has a use for.
  userId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

/**
 * The related names a directory row needs, so a list does not fire a query per
 * row to resolve a department or a manager name (Scalable pillar: no N+1).
 */
const RELATION_SELECT = {
  // ADR-069's off-boarding amendment made this join necessary, and the reason is
  // worth stating: revoking access SOFT-DELETES the `User` and deliberately KEEPS
  // `Employee.userId` pointing at it, so the link survives a restore. Deriving
  // "can sign in" from the id alone therefore reported a departed employee as
  // still having a login — on `/admin/roles`, the one screen built to answer that
  // question. A to-one join, not an N+1.
  user: { select: { deletedAt: true } },
  department: { select: { id: true, name: true } },
  entity: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, name: true, email: true } },
  // HR Centre F-a — a to-one join like the three above.
  team: { select: { id: true, name: true } },
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
  /** §3.3, as an ISO calendar DAY — the column is a date, and the time is noise. */
  dateOfJoining: string | null;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string; name: string };
  manager: { id: string; name: string; email: string } | null;
  /** HR Centre F-a — the optional team inside the department. */
  team: { id: string; name: string } | null;
  /**
   * ADR-069 — can this person reach the app, and if not, why not?
   *
   * An employee record and a login are separate rows (ADR-065), and before the
   * import provisioned logins they routinely disagreed: thirty-six people in the
   * directory, one who could sign in. HR editing §4.1 roles needs both facts on
   * one screen, because granting HRBP to someone with no account grants nothing.
   *
   * THREE states, not a boolean, and the third is the one that cost a review to
   * find. Off-boarding soft-deletes the `User` while keeping `Employee.userId`
   * pointed at it, so "has a link" and "can sign in" stopped being the same
   * question the moment revocation shipped:
   *
   *   NONE     — no account was ever created. The ordinary state for a fixture
   *              seeded before provisioning existed.
   *   ACTIVE   — a live account. Whether a PASSWORD or an IdP will let them
   *              through is a separate question this does not answer.
   *   REVOKED  — an account exists and was deliberately taken away (§12.1
   *              off-boarding). Restorable from the recycling bin by a person,
   *              which is why it must not read as NONE: the remedies differ, and
   *              creating a second account on that email is refused by the unique
   *              index.
   *
   * Never the user id itself: the platform identity's primary key is not an
   * answer any employee screen needs.
   */
  loginState: "NONE" | "ACTIVE" | "REVOKED";
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
  dateOfJoining: Date | null;
  managerId: string | null;
  department: { id: string; name: string } | null;
  entity: { id: string; code: string; name: string };
  manager: { id: string; name: string; email: string } | null;
  team?: { id: string; name: string } | null;
  userId?: string | null;
  user?: { deletedAt: Date | null } | null;
  basicSalaryEnc?: string | null;
}): EmployeeListRow {
  const out: EmployeeListRow = {
    id: row.id,
    odooId: row.odooId,
    name: row.name,
    email: row.email,
    roleTrack: row.roleTrack,
    status: row.status,
    dateOfJoining: row.dateOfJoining?.toISOString().slice(0, 10) ?? null,
    managerId: row.managerId,
    department: row.department,
    entity: row.entity,
    team: row.team ?? null,
    loginState: loginStateOf(row),
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
 * Which of the three login states this row is in — see `loginState` on
 * `EmployeeListRow` for what each means.
 *
 * Reads the JOINED user, not the id. The id alone cannot distinguish a live
 * account from a revoked one, and after ADR-069's off-boarding amendment that
 * distinction is the whole point of the field.
 *
 * A caller whose `select` omitted the join reports NONE rather than guessing:
 * under-claiming access is the safe direction for a field HR acts on, and every
 * read path in the app goes through `employeeSelect`, which carries it.
 */
function loginStateOf(row: {
  userId?: string | null;
  user?: { deletedAt: Date | null } | null;
}): "NONE" | "ACTIVE" | "REVOKED" {
  if (!row.userId) return "NONE";
  if (row.user === undefined) return "NONE";
  if (row.user === null) return "NONE";
  return row.user.deletedAt === null ? "ACTIVE" : "REVOKED";
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

// --- HR Centre F-b: the full record (blueprint §2) ---------------------------

/** Job & contract (Internal) and work contact (Confidential): any viewer. */
const RECORD_BASE_SELECT = {
  jobTitle: true,
  grade: true,
  contractType: true,
  probationEndDate: true,
  workLocation: true,
  workPhone: true,
  department: {
    select: { id: true, name: true, directorate: { select: { id: true, name: true } } },
  },
} satisfies Prisma.EmployeeSelect;

/** Personal details — only with `people.viewPersonal` (AC-F2.3). */
const PERSONAL_SELECT = {
  personalEmail: true,
  personalPhone: true,
  dateOfBirth: true,
  gender: true,
  nationality: true,
} satisfies Prisma.EmployeeSelect;

/** ID documents — Restricted, only with `people.viewIdDocuments` (AC-F2.2). */
const ID_DOCUMENT_SELECT = {
  civilIdNumberEnc: true,
  civilIdExpiry: true,
  passportNumberEnc: true,
  passportExpiry: true,
} satisfies Prisma.EmployeeSelect;

/**
 * `select` for ONE employee's record page. The list keeps the lean
 * `employeeSelect` (Speed pillar); the detail adds the record fields, each group
 * only for an actor entitled to it — the same query-layer gate as salary, so an
 * unentitled payload has nothing to leak.
 */
export function employeeDetailSelect(actor: PmsActor, subject?: ScopeSubject) {
  // F-c — with the target's placement, a SCOPED grant counts (an HRBP for
  // Codeline sees a Codeline employee's personal details); without it, only a
  // Group grant does (lists — fail closed).
  const may = (permission: Permission, groupAnswer: boolean) =>
    subject ? actorCan(actor, permission, subject) : groupAnswer;
  const base = { ...BASE_EMPLOYEE_SELECT, ...RELATION_SELECT, ...RECORD_BASE_SELECT };
  return {
    ...base,
    ...(may("people.viewSalary", canViewCompensation(actor))
      ? { basicSalaryEnc: true as const }
      : {}),
    ...(may("people.viewPersonal", canViewPersonal(actor)) ? PERSONAL_SELECT : {}),
    ...(may("people.viewIdDocuments", canViewIdDocuments(actor)) ? ID_DOCUMENT_SELECT : {}),
  };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type EmployeeRecordView = {
  jobTitle: string | null;
  grade: string | null;
  contractType: string | null;
  probationEndDate: string | null;
  workLocation: string | null;
  workPhone: string | null;
  directorate: { id: string; name: string } | null;
  /** Present only for `people.viewPersonal`. */
  personal?: {
    personalEmail: string | null;
    personalPhone: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    nationality: string | null;
  };
  /** Present only for `people.viewIdDocuments`. */
  idDocuments?: {
    civilIdNumber: string | null;
    civilIdExpiry: string | null;
    passportNumber: string | null;
    passportExpiry: string | null;
    /** True when a stored number exists but the server key cannot open it. */
    unavailable: boolean;
  };
};

type DetailRow = Parameters<typeof serializeEmployee>[0] & {
  jobTitle: string | null;
  grade: string | null;
  contractType: string | null;
  probationEndDate: Date | null;
  workLocation: string | null;
  workPhone: string | null;
  department: {
    id: string;
    name: string;
    directorate?: { id: string; name: string } | null;
  } | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  nationality?: string | null;
  civilIdNumberEnc?: string | null;
  civilIdExpiry?: Date | null;
  passportNumberEnc?: string | null;
  passportExpiry?: Date | null;
};

/** Serialise a detail row: the list shape plus `record`, keys omitted when gated. */
export function serializeEmployeeDetail(
  row: DetailRow,
): EmployeeListRow & { record: EmployeeRecordView } {
  const record: EmployeeRecordView = {
    jobTitle: row.jobTitle,
    grade: row.grade,
    contractType: row.contractType,
    probationEndDate: day(row.probationEndDate),
    workLocation: row.workLocation,
    workPhone: row.workPhone,
    directorate: row.department?.directorate ?? null,
  };
  if ("dateOfBirth" in row) {
    record.personal = {
      personalEmail: row.personalEmail ?? null,
      personalPhone: row.personalPhone ?? null,
      dateOfBirth: day(row.dateOfBirth),
      gender: row.gender ?? null,
      nationality: row.nationality ?? null,
    };
  }
  if ("civilIdNumberEnc" in row) {
    const civil = readIdNumber(row.civilIdNumberEnc ?? null, row.odooId);
    const passport = readIdNumber(row.passportNumberEnc ?? null, row.odooId);
    record.idDocuments = {
      civilIdNumber: civil.value,
      civilIdExpiry: day(row.civilIdExpiry),
      passportNumber: passport.value,
      passportExpiry: day(row.passportExpiry),
      unavailable: civil.unavailable || passport.unavailable,
    };
  }
  const department = row.department ? { id: row.department.id, name: row.department.name } : null;
  return { ...serializeEmployee({ ...row, department }), record };
}
