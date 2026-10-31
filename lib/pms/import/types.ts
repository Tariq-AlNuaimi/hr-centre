import { createHash } from "node:crypto";
import type { EmployeeStatus, RoleTrack } from "@/generated/prisma/client";
import type { EmployeeRecordInput, RecordField } from "@/lib/people/record";

/**
 * The import layer's canonical shapes — spec §3.1.
 *
 * "Implement import as an import layer writing into an internal employee table
 * the system owns. Excel is one loader; Odoo becomes a second loader into the
 * same table. Downstream logic must never read the import file directly."
 *
 * `EmployeeSourceRow` IS that boundary. A loader's only job is to produce these;
 * validation, reconciliation, and persistence never learn where a row came from.
 * When the v2 Odoo sync lands (§14), it adds `loaders/odoo.ts` emitting the same
 * shape and nothing downstream changes.
 *
 * Every field is `string | null` as it leaves a loader, deliberately: a
 * spreadsheet cell is text until something decides otherwise, and "decides
 * otherwise" is validation's job (validate.ts), where a bad value produces a
 * REJECT with a reason rather than a silent coercion. A loader that parsed
 * `"3.5"` into a number would be making a validation decision in the wrong file
 * and would have nowhere to report a failure.
 */
export type EmployeeSourceRow = {
  /**
   * 1-based row number in the source, including the header row, so an HR user
   * reading a rejection can look at that line in Excel. Not data — provenance.
   */
  rowNumber: number;
  odooId: string | null;
  name: string | null;
  email: string | null;
  dateOfJoining: string | null;
  department: string | null;
  /**
   * F-a — optional org columns. `undefined` means the COLUMN is absent from the
   * sheet (keep what is on file); `null` means the cell is blank (clear it).
   * Optional in the type so a sheet built for Performance still imports.
   */
  directorate?: string | null;
  team?: string | null;
  entity: string | null;
  managerOdooId: string | null;
  roleTrack: string | null;
  basicSalary: string | null;
  status: string | null;
  lastWorkingDay: string | null;
  unpaidLeaveDays: string | null;
} & Partial<Record<RecordField, string | null>>;

/** The eleven §3.3 fields, in the order they appear in the spec's own table. */
export const IMPORT_COLUMNS = [
  "odooId",
  "name",
  "email",
  "dateOfJoining",
  "department",
  "directorate",
  "team",
  "entity",
  "managerOdooId",
  "roleTrack",
  "basicSalary",
  "status",
  "lastWorkingDay",
  "unpaidLeaveDays",
  // HR Centre F-b — the full record (blueprint §2). Optional columns; names are
  // the writer's own field names (lib/people/record.ts) so nothing is mapped twice.
  "jobTitle",
  "grade",
  "contractType",
  "probationEndDate",
  "workLocation",
  "workPhone",
  "personalEmail",
  "personalPhone",
  "dateOfBirth",
  "gender",
  "nationality",
  "civilIdNumber",
  "civilIdExpiry",
  "passportNumber",
  "passportExpiry",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/**
 * Header text HR sees in the template, mapped to the canonical field. Matching
 * is case-insensitive and whitespace-tolerant (see loaders/xlsx.ts), because an
 * HR user who types "Employee ID " with a trailing space has not made a mistake
 * worth failing an import over.
 *
 * Several spellings map to one field on purpose: HR exports from Odoo, Excel,
 * and Google Sheets carry different habitual labels for the same column, and
 * §3.3 names the CONCEPT ("Employee ID — Odoo ID; permanent unique key") rather
 * than a literal header string.
 */
export const COLUMN_ALIASES: Record<ImportColumn, readonly string[]> = {
  odooId: ["employee id", "employeeid", "odoo id", "odooid", "id"],
  name: ["name", "employee name", "full name"],
  email: ["email", "email address", "work email"],
  dateOfJoining: [
    "date of joining",
    "dateofjoining",
    "joining date",
    "date joined",
    "hire date",
    "start date",
  ],
  department: ["department", "dept"],
  directorate: ["directorate"],
  team: ["team", "team name"],
  entity: ["entity", "company", "legal entity"],
  managerOdooId: ["manager", "manager id", "manager employee id", "line manager", "reports to"],
  roleTrack: ["role track", "roletrack", "track", "role"],
  basicSalary: ["basic salary", "salary", "basic"],
  status: ["status", "employment status"],
  lastWorkingDay: ["last working day", "lastworkingday", "lwd", "end date"],
  unpaidLeaveDays: ["unpaid leave days", "unpaid leave", "unpaidleavedays", "lop days"],
  jobTitle: ["job title", "jobtitle", "position", "designation"],
  grade: ["grade", "job grade"],
  contractType: ["contract type", "contracttype", "contract", "employment type"],
  probationEndDate: ["probation end date", "probation end", "probationenddate"],
  workLocation: ["work location", "worklocation", "location", "office"],
  workPhone: ["work phone", "workphone", "work mobile", "office phone"],
  personalEmail: ["personal email", "personalemail", "private email"],
  personalPhone: ["personal phone", "personalphone", "mobile", "private phone"],
  dateOfBirth: ["date of birth", "dateofbirth", "dob", "birth date", "birthday"],
  gender: ["gender", "sex"],
  nationality: ["nationality", "country of nationality"],
  civilIdNumber: ["civil id number", "civil id", "civilidnumber", "civil id no", "national id"],
  civilIdExpiry: ["civil id expiry", "civil id expiry date", "civilidexpiry"],
  passportNumber: ["passport number", "passport", "passportnumber", "passport no"],
  passportExpiry: ["passport expiry", "passport expiry date", "passportexpiry"],
};

/** Human-facing column titles for the downloadable template (§3.3 wording). */
export const COLUMN_TITLES: Record<ImportColumn, string> = {
  odooId: "Employee ID",
  name: "Name",
  email: "Email",
  dateOfJoining: "Date of Joining",
  department: "Department",
  directorate: "Directorate",
  team: "Team",
  entity: "Entity",
  managerOdooId: "Manager (Employee ID)",
  roleTrack: "Role Track",
  basicSalary: "Basic Salary",
  status: "Status",
  lastWorkingDay: "Last Working Day",
  unpaidLeaveDays: "Unpaid Leave Days",
  jobTitle: "Job Title",
  grade: "Grade",
  contractType: "Contract Type",
  probationEndDate: "Probation End Date",
  workLocation: "Work Location",
  workPhone: "Work Phone",
  personalEmail: "Personal Email",
  personalPhone: "Personal Phone",
  dateOfBirth: "Date of Birth",
  gender: "Gender",
  nationality: "Nationality",
  civilIdNumber: "Civil ID Number",
  civilIdExpiry: "Civil ID Expiry",
  passportNumber: "Passport Number",
  passportExpiry: "Passport Expiry",
};

/**
 * A validation finding. `severity` is the whole point of the type:
 *
 *   REJECT  — §3.4: "A row failing any rule is rejected/flagged, never silently
 *             accepted." The row is not applied.
 *   WARNING — the row IS applied, but something about it deserves a human's
 *             attention. The canonical case is §3.2's stable key doing exactly
 *             what it promises: an existing `odooId` arriving with a different
 *             name or email is a legitimate update (people marry, emails get
 *             renamed), and also exactly what a reused-ID data-entry error looks
 *             like. Refusing it would break the spec; applying it silently would
 *             hide a person being overwritten. So it applies, and it is shown.
 */
type IssueSeverity = "REJECT" | "WARNING";

export type ImportIssue = {
  rowNumber: number;
  odooId: string | null;
  field: ImportColumn | null;
  /** Machine-readable rule key, stable across locales; the UI translates it. */
  rule: string;
  message: string;
  severity: IssueSeverity;
};

/**
 * A row that passed validation, with every value resolved to the type the
 * database wants and every reference resolved to a real id. Nothing downstream
 * of this re-parses or re-looks-up anything.
 */
export type ValidatedRow = {
  rowNumber: number;
  odooId: string;
  name: string;
  email: string;
  departmentId: string | null;
  /** F-a — undefined when the sheet has no Team column (keep the current team). */
  teamId?: string | null;
  entityId: string;
  /**
   * ADR-103 — the catalogue grade the row's grade code names (undefined when the
   * sheet has no Grade column: keep the grade on file; null = clear it).
   */
  gradeId?: string | null;
  /**
   * Resolved LATER than the rest of the row: a manager may appear further down
   * the same file and therefore have no database id at validation time. Held as
   * the source `odooId` and resolved during reconciliation, once every row in
   * the batch is known. See reconcile.ts.
   */
  managerOdooId: string | null;
  roleTrack: RoleTrack;
  basicSalary: string | null;
  status: EmployeeStatus;
  /// §3.3's anchor for §11's eligibility gate and pro-ration.
  dateOfJoining: Date | null;
  lastWorkingDay: Date | null;
  unpaidLeaveDays: number;
  /** F-b — natural-form record fields; a key is absent when its column is. */
  record?: EmployeeRecordInput;
};

/** One field's before/after in an update, for the preview diff. */
export type FieldChange = {
  field: string;
  /** Already redacted for Restricted fields — see reconcile.ts. */
  from: string | null;
  to: string | null;
};

export type PlannedCreate = {
  action: "CREATE";
  rowNumber: number;
  odooId: string;
  name: string;
  email: string;
  departmentName: string | null;
  entityCode: string;
  roleTrack: RoleTrack;
  status: EmployeeStatus;
};

export type PlannedUpdate = {
  action: "UPDATE";
  rowNumber: number;
  odooId: string;
  employeeId: string;
  name: string;
  changes: FieldChange[];
};

/**
 * An employee in the table but absent from the file.
 *
 * §3.5: "Missing rows → change nothing. Absence from a file is never
 * interpreted as a departure. (Protects against truncated/filtered exports
 * wiping people.)"
 *
 * This type exists so that "nothing happens" is VISIBLE rather than merely
 * true. HR sees the list of people the file did not mention, and sees that the
 * plan does nothing to them. That is the difference between an invariant a
 * reviewer can check and one they have to take on faith.
 */
export type AbsentEmployee = {
  action: "ABSENT_NO_CHANGE";
  employeeId: string;
  odooId: string;
  name: string;
};

/**
 * The complete dry run.
 *
 * The human-facing half is persisted to `ImportBatch.previewJson`; `validRows`
 * is NOT, because it carries Restricted salary figures and that column is read
 * back by any HR user who can see the batch. So the apply step does not replay a
 * stored plan — it re-parses the file the operator re-submits and re-derives the
 * rows against a live org.
 *
 * That re-derivation is what makes "the operator confirms exactly what they were
 * shown" a claim needing enforcement rather than a structural fact, which is why
 * `planDigest` below is persisted next to the plan and re-checked at apply.
 */
export type ImportPreview = {
  filename: string;
  rowsTotal: number;
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  absent: AbsentEmployee[];
  issues: ImportIssue[];
  /** Rows that will actually be written, in file order. Not shown; applied. */
  validRows: ValidatedRow[];
};

export type ImportCounts = {
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  rowsAbsent: number;
};

export function countsFor(preview: ImportPreview): ImportCounts {
  return {
    rowsTotal: preview.rowsTotal,
    rowsCreated: preview.creates.length,
    rowsUpdated: preview.updates.length,
    // Distinct ROWS rejected, not issues raised: one row can break several rules
    // at once and §3.4 reports them all, but it is still one rejected row.
    rowsRejected: new Set(
      preview.issues.filter((i) => i.severity === "REJECT").map((i) => i.rowNumber),
    ).size,
    rowsAbsent: preview.absent.length,
  };
}

/**
 * A content fingerprint of the rows an apply will actually write.
 *
 * The two-step preview→confirm flow exists so the operator "confirms exactly
 * what they were shown". Comparing the three aggregate COUNTS does not deliver
 * that: a different file with coincidentally the same shape — one create, no
 * updates, no rejects — passes the comparison and gets written. That is not a
 * contrived case; the ordinary way to hit it is to re-upload a newer export at
 * the confirm step and have it happen to add the same number of people.
 *
 * So the plan is fingerprinted at preview time and re-checked at apply. The
 * digest covers every field that will be written, over rows sorted by the stable
 * key so file ORDER alone cannot change it (§3.2 — reordering a sheet is not a
 * different plan).
 *
 * `basicSalary` is included. The digest is one-way, and anyone who can read it
 * back can read the salary column itself far more easily, so hashing it costs no
 * confidentiality and omitting it would let a substituted file change pay
 * undetected — the single most sensitive thing an import can do.
 */
export function planDigest(validRows: ValidatedRow[]): string {
  const canonical = [...validRows]
    .sort((a, b) => (a.odooId < b.odooId ? -1 : a.odooId > b.odooId ? 1 : 0))
    .map((r) => [
      r.odooId,
      r.name,
      r.email,
      r.departmentId ?? "",
      r.entityId,
      r.managerOdooId ?? "",
      r.roleTrack,
      r.basicSalary ?? "",
      r.status,
      // Date | null — serialise as a stable calendar day, not a locale string.
      r.lastWorkingDay ? r.lastWorkingDay.toISOString().slice(0, 10) : "",
      String(r.unpaidLeaveDays),
      // F-a. "~" marks "column absent" so it cannot collide with a blank cell.
      r.teamId === undefined ? "~" : (r.teamId ?? ""),
      // F-b. ID numbers included for the reason salary is (see above).
      JSON.stringify(r.record ?? {}),
    ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
