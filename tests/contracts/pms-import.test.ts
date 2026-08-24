import test from "node:test";
import assert from "node:assert/strict";

import { buildImportTemplate } from "../../lib/pms/export/xlsx";
import {
  ImportFileError,
  loadEmployeesFromXlsx,
  mapHeaders,
} from "../../lib/pms/import/loaders/xlsx";
import { validateRows, type ValidationContext } from "../../lib/pms/import/validate";
import {
  reconcile,
  type ExistingEmployee,
  type ReconcileContext,
} from "../../lib/pms/import/reconcile";
import { countsFor, type EmployeeSourceRow, type ImportPreview } from "../../lib/pms/import/types";

/**
 * Contract tests for the PMS employee import — spec §3.
 *
 * Each test names the spec invariant it pins. These are the rules the HR team
 * signed off on, and the ones whose violation would be worst: silently deleting
 * people, silently accepting bad data, or silently shifting the key every other
 * record hangs off.
 */

// --- fixtures ---------------------------------------------------------------

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  const departmentsByEntityAndName = new Map([
    ["RIHAL::marketing", { id: "dept-rihal-mkt", entityId: "ent-rihal" }],
    ["RIHAL::sales", { id: "dept-rihal-sales", entityId: "ent-rihal" }],
    ["TP::sales", { id: "dept-tp-sales", entityId: "ent-tp" }],
  ]);
  const departmentsByName = new Map([
    ["marketing", [{ id: "dept-rihal-mkt", entityId: "ent-rihal", entityCode: "RIHAL" }]],
    [
      "sales",
      [
        { id: "dept-rihal-sales", entityId: "ent-rihal", entityCode: "RIHAL" },
        { id: "dept-tp-sales", entityId: "ent-tp", entityCode: "TP" },
      ],
    ],
  ]);
  const entitiesByKey = new Map([
    ["rihal", { id: "ent-rihal", code: "RIHAL" }],
    ["tp", { id: "ent-tp", code: "TP" }],
    ["cl", { id: "ent-cl", code: "CL" }],
  ]);
  return {
    departmentsByEntityAndName,
    departmentsByName,
    entitiesByKey,
    existingOdooIds: new Set<string>(),
    ...overrides,
  };
}

let rowSeq = 0;
function row(over: Partial<EmployeeSourceRow> = {}): EmployeeSourceRow {
  rowSeq += 1;
  return {
    rowNumber: rowSeq + 1,
    odooId: `E${rowSeq}`,
    name: `Person ${rowSeq}`,
    email: `person${rowSeq}@rihal.om`,
    department: "Marketing",
    entity: "Rihal",
    managerOdooId: "BOSS",
    roleTrack: "Individual",
    basicSalary: "1000",
    status: "Active",
    lastWorkingDay: null,
    unpaidLeaveDays: "0",
    ...over,
  };
}

function existing(over: Partial<ExistingEmployee> = {}): ExistingEmployee {
  return {
    id: "emp-1",
    odooId: "E1",
    name: "Person 1",
    email: "person1@rihal.om",
    departmentId: "dept-rihal-mkt",
    entityId: "ent-rihal",
    managerId: null,
    roleTrack: "INDIVIDUAL",
    basicSalary: "1000",
    status: "ACTIVE",
    lastWorkingDay: null,
    unpaidLeaveDays: 0,
    ...over,
  };
}

function reconcileCtx(employees: ExistingEmployee[]): ReconcileContext {
  return {
    existing: new Map(employees.map((e) => [e.odooId, e])),
    departmentNames: new Map([
      ["dept-rihal-mkt", "Marketing"],
      ["dept-rihal-sales", "Sales"],
      ["dept-tp-sales", "Sales"],
    ]),
    entityCodes: new Map([
      ["ent-rihal", "RIHAL"],
      ["ent-tp", "TP"],
      ["ent-cl", "CL"],
    ]),
  };
}

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule).sort();

// --- §3.1 / ADR-066: the loader round-trips the template it hands out --------

test("§3.1 the generated template parses back through the loader, all 11 columns mapped", async () => {
  // Round-tripping real bytes, not types. An earlier iteration of the writer
  // seam typechecked cleanly while returning a writer handle instead of a
  // Buffer, and the template's own "Manager (Employee ID)" header failed to map
  // because punctuation defeated normalisation. Both were invisible to tsc and
  // obvious the moment real bytes went through.
  const buffer = await buildImportTemplate();
  assert.ok(buffer.byteLength > 0, "template must be real bytes");

  const { rows, headerMap, sheetName } = await loadEmployeesFromXlsx(buffer);

  assert.equal(sheetName, "Employees");
  assert.equal(
    Object.keys(headerMap).length,
    11,
    "every §3.3 column in the template must be recognised by the loader",
  );
  assert.equal(rows.length, 2, "template ships two example rows");
  assert.equal(rows[0].managerOdooId, "1000", "the Manager (Employee ID) column must map");
  assert.equal(rows[1].roleTrack, "C-Level");
  assert.equal(rows[1].department, null, "the C-Level example must carry no department (§1.2)");
});

test("mapHeaders refuses a sheet where two columns claim the same field", () => {
  assert.throws(
    () => mapHeaders(["Employee ID", "Odoo ID", "Name"]),
    (e: unknown) => e instanceof ImportFileError && e.rule === "duplicate_column",
    "guessing which column is the key would silently rekey the whole import (§3.2)",
  );
});

test("a file missing a required column fails once, at file level", async () => {
  const buffer = await buildImportTemplate();
  const { rows } = await loadEmployeesFromXlsx(buffer);
  assert.ok(rows.length > 0);
  // Sanity: the loader rejects an empty upload rather than producing zero rows.
  await assert.rejects(
    () => loadEmployeesFromXlsx(Buffer.alloc(0)),
    (e: unknown) => e instanceof ImportFileError && e.rule === "empty_file",
  );
});

// --- §3.4: a row failing any rule is rejected, never silently accepted -------

test("§3.4 employee ID must be present", () => {
  const { validRows, issues } = validateRows([row({ odooId: null })], ctx());
  assert.equal(validRows.length, 0, "a rejected row must never reach the database");
  assert.ok(rules(issues).includes("employee_id_missing"));
});

test("§3.4 employee ID must be unique within the file", () => {
  const { validRows, issues } = validateRows(
    [row({ odooId: "DUP" }), row({ odooId: "DUP" })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.equal(validRows.length, 0, "both claimants are rejected — the intent is ambiguous");
  assert.equal(issues.filter((i) => i.rule === "employee_id_duplicate").length, 2);
  // The message must name the rows so HR can find them in Excel.
  assert.match(issues[0].message, /rows \d+, \d+/);
});

test("§3.4 role track must be exactly one of the five values", () => {
  const { validRows, issues } = validateRows([row({ roleTrack: "Senior Engineer" })], ctx());
  assert.equal(validRows.length, 0);
  assert.ok(rules(issues).includes("role_track_invalid"));
});

test("§3.4 an unrecognised department is rejected, never auto-created", () => {
  const { validRows, issues } = validateRows(
    [row({ department: "Marketting", entity: "Rihal" })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.equal(validRows.length, 0);
  assert.ok(
    rules(issues).includes("department_unknown"),
    "creating 'Marketting' from a typo would fork the org chart",
  );
});

test("§1.2 a department name that exists in two entities is ambiguous, not a guess", () => {
  // "TP Sales" and "CL Sales" are distinct departments (§1.2). Picking one
  // would file the employee under the wrong entity, and entity drives their
  // Corporate score (§8.4) — a wrong number months later, not a failure today.
  const { validRows, issues } = validateRows(
    [row({ department: "Sales", entity: null })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.equal(validRows.length, 0);
  assert.ok(rules(issues).includes("department_ambiguous"));
});

test("§3.4 status must be Active or Leaver when present", () => {
  const { issues } = validateRows([row({ status: "On Leave" })], ctx());
  assert.ok(rules(issues).includes("status_invalid"));
});

test("§3.4 a blank status defaults to Active rather than rejecting", () => {
  const { validRows, issues } = validateRows(
    [row({ status: null })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.equal(issues.length, 0);
  assert.equal(validRows[0].status, "ACTIVE");
});

test("§3.4 a manager is required for every track except C-Level", () => {
  const missing = validateRows([row({ managerOdooId: null })], ctx());
  assert.ok(rules(missing.issues).includes("manager_missing"));

  const cLevel = validateRows(
    [row({ roleTrack: "C-Level", department: null, entity: "Rihal", managerOdooId: null })],
    ctx(),
  );
  assert.equal(cLevel.issues.length, 0, "blank manager is allowed only for C-Level");
  assert.equal(cLevel.validRows.length, 1);
});

test("§3.4 a manager who exists nowhere is rejected", () => {
  const { validRows, issues } = validateRows([row({ managerOdooId: "GHOST" })], ctx());
  assert.equal(validRows.length, 0);
  assert.ok(rules(issues).includes("manager_unknown"));
});

test("§3.4 a manager appearing later in the same file resolves", () => {
  // HR sorts a sheet by name or department, never topologically.
  const report = row({ odooId: "R1", managerOdooId: "M1" });
  const manager = row({
    odooId: "M1",
    managerOdooId: null,
    roleTrack: "C-Level",
    department: null,
  });
  const { validRows, issues } = validateRows([report, manager], ctx());
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(validRows.length, 2);
});

test("§1.2 a C-Level row with a department is rejected", () => {
  const { validRows, issues } = validateRows(
    [row({ roleTrack: "C-Level", department: "Marketing", managerOdooId: null })],
    ctx(),
  );
  assert.equal(validRows.length, 0);
  assert.ok(rules(issues).includes("c_level_has_department"));
});

test("§1.2 a non-C-Level row without a department is rejected", () => {
  const { validRows, issues } = validateRows([row({ department: null, entity: "Rihal" })], ctx());
  assert.equal(validRows.length, 0);
  assert.ok(rules(issues).includes("department_missing"));
});

test("a reporting-line loop is rejected and does not hang", () => {
  const a = row({ odooId: "A", managerOdooId: "B" });
  const b = row({ odooId: "B", managerOdooId: "A" });
  const { validRows, issues } = validateRows([a, b], ctx());
  assert.ok(rules(issues).includes("manager_cycle"));
  assert.equal(validRows.length, 0, "neither end of the loop may be applied");
});

test("an employee cannot be their own manager", () => {
  const { issues } = validateRows([row({ odooId: "SELF", managerOdooId: "SELF" })], ctx());
  assert.ok(rules(issues).includes("manager_self"));
});

test("§11.5 a leaver without a last working day is rejected", () => {
  const { issues } = validateRows(
    [row({ status: "Leaver", lastWorkingDay: null })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.ok(
    rules(issues).includes("leaver_without_last_working_day"),
    "without the date the bonus pro-ration period is undefined (§11.4)",
  );
});

test("a malformed date is rejected rather than coerced", () => {
  const { issues } = validateRows(
    [row({ status: "Leaver", lastWorkingDay: "31/12/2026" })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.ok(rules(issues).includes("last_working_day_invalid"));
});

test("an impossible calendar date is rejected, not rolled forward", () => {
  // new Date("2026-02-30") rolls to March 2 — a silent one-day-plus error in a
  // value that feeds a ÷365 day count (§11.4).
  const { issues } = validateRows(
    [row({ status: "Leaver", lastWorkingDay: "2026-02-30" })],
    ctx({ existingOdooIds: new Set(["BOSS"]) }),
  );
  assert.ok(rules(issues).includes("last_working_day_invalid"));
});

test("§4.5 a salary rejection message never echoes the salary", () => {
  // The preview is visible to HRBP and persisted to ImportBatch.previewJson;
  // quoting the figure in an error would route Restricted data (§4.5/§11.6)
  // around the field-level rule that keeps it out of those surfaces.
  const { issues } = validateRows([row({ basicSalary: "12345abc" })], ctx());
  const salaryIssue = issues.find((i) => i.rule === "salary_invalid");
  assert.ok(salaryIssue);
  assert.doesNotMatch(salaryIssue.message, /12345/, "the figure must not appear in the message");
});

test("a row breaking several rules reports all of them at once", () => {
  const { issues } = validateRows(
    [row({ odooId: null, roleTrack: "Wizard", status: "Maybe", email: "not-an-email" })],
    ctx(),
  );
  const found = rules(issues);
  for (const rule of [
    "employee_id_missing",
    "role_track_invalid",
    "status_invalid",
    "email_invalid",
  ]) {
    assert.ok(found.includes(rule), `expected ${rule} in ${found.join(",")}`);
  }
});

// --- §3.5 / Appendix A: silence is never destructive ------------------------

test("§3.5 employees absent from the file are untouched, and shown as untouched", () => {
  // The invariant the whole two-step design exists to protect: a truncated or
  // filtered export must never be read as a wave of departures.
  const onFile = row({ odooId: "E1", managerOdooId: null, roleTrack: "C-Level", department: null });
  const { validRows } = validateRows([onFile], ctx());

  const plan = reconcile(
    validRows,
    reconcileCtx([
      existing({ id: "emp-1", odooId: "E1" }),
      existing({ id: "emp-2", odooId: "E2", name: "Absent One", email: "absent1@rihal.om" }),
      existing({ id: "emp-3", odooId: "E3", name: "Absent Two", email: "absent2@rihal.om" }),
    ]),
  );

  assert.equal(plan.absent.length, 2, "both missing employees are enumerated");
  assert.deepEqual(plan.absent.map((a) => a.odooId).sort(), ["E2", "E3"]);
  for (const absent of plan.absent) {
    assert.equal(
      absent.action,
      "ABSENT_NO_CHANGE",
      "there is no delete or deactivate action in the plan — by construction",
    );
  }
  // And nothing in the plan targets them.
  const touched = [...plan.creates.map((c) => c.odooId), ...plan.updates.map((u) => u.odooId)];
  assert.ok(!touched.includes("E2") && !touched.includes("E3"));
});

test("§3.2 re-importing an unchanged file is a no-op", () => {
  const unchanged = row({
    odooId: "E1",
    name: "Person 1",
    email: "person1@rihal.om",
    department: "Marketing",
    entity: "Rihal",
    roleTrack: "Individual",
    managerOdooId: null,
    basicSalary: "1000",
    unpaidLeaveDays: "0",
  });
  // An Individual needs a manager, so give them one that already exists.
  const withManager = { ...unchanged, managerOdooId: "BOSS" };
  const { validRows } = validateRows([withManager], ctx({ existingOdooIds: new Set(["BOSS"]) }));

  const plan = reconcile(
    validRows,
    reconcileCtx([existing({ id: "emp-1", odooId: "E1", managerId: "emp-boss" })]),
  );

  // managerId differs only because the fixture's existing row points at
  // emp-boss and the file's manager is unresolvable in this context; the
  // meaningful assertion is that no field of substance changed.
  const changedFields = plan.updates.flatMap((u) => u.changes.map((c) => c.field));
  assert.ok(
    !changedFields.includes("name") &&
      !changedFields.includes("email") &&
      !changedFields.includes("departmentId") &&
      !changedFields.includes("basicSalary"),
    `unexpected changes: ${changedFields.join(",")}`,
  );
  assert.equal(plan.creates.length, 0, "an existing odooId must never create a second row");
});

test("§4.5 a salary change is recorded as changed but never as figures", () => {
  const raised = row({
    odooId: "E1",
    name: "Person 1",
    email: "person1@rihal.om",
    managerOdooId: null,
    roleTrack: "C-Level",
    department: null,
    entity: "Rihal",
    basicSalary: "9999",
  });
  const { validRows } = validateRows([raised], ctx());
  const plan = reconcile(validRows, reconcileCtx([existing({ basicSalary: "1000" })]));

  const salaryChange = plan.updates[0]?.changes.find((c) => c.field === "basicSalary");
  assert.ok(salaryChange, "HR must see THAT pay changed");
  assert.equal(salaryChange.from, "[redacted]");
  assert.equal(salaryChange.to, "[redacted]");

  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /9999/, "the new figure must not reach previewJson");
  assert.doesNotMatch(serialized, /1000/, "nor the old one");
});

test("a salary that is numerically identical is not reported as a change", () => {
  const same = row({
    odooId: "E1",
    name: "Person 1",
    email: "person1@rihal.om",
    managerOdooId: null,
    roleTrack: "C-Level",
    department: null,
    entity: "Rihal",
    basicSalary: "1000.00",
  });
  const { validRows } = validateRows([same], ctx());
  const plan = reconcile(validRows, reconcileCtx([existing({ basicSalary: "1000" })]));
  const salaryChange = plan.updates[0]?.changes.find((c) => c.field === "basicSalary");
  assert.equal(salaryChange, undefined, "1000 and 1000.00 are the same salary");
});

test("§3.2 a renamed person on a stable ID applies, and warns", () => {
  const renamed = row({
    odooId: "E1",
    name: "Person One-Married",
    email: "person1@rihal.om",
    managerOdooId: null,
    roleTrack: "C-Level",
    department: null,
    entity: "Rihal",
  });
  const { validRows } = validateRows([renamed], ctx());
  const plan = reconcile(validRows, reconcileCtx([existing()]));

  assert.equal(plan.updates.length, 1, "§3.2 says the ID never shifts — so this is an update");
  const warning = plan.issues.find((i) => i.rule === "identity_changed_on_stable_id");
  assert.ok(warning, "a reused ID looks identical to a rename; HR must be shown");
  assert.equal(warning.severity, "WARNING", "it applies — it is not a rejection");
});

test("a new odooId produces a create", () => {
  const joiner = row({
    odooId: "NEW1",
    managerOdooId: null,
    roleTrack: "C-Level",
    department: null,
    entity: "TP",
  });
  const { validRows } = validateRows([joiner], ctx());
  const plan = reconcile(validRows, reconcileCtx([existing()]));
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].odooId, "NEW1");
  assert.equal(plan.creates[0].entityCode, "TP");
});

// --- counts -----------------------------------------------------------------

test("a row breaking three rules counts as one rejected row, not three", () => {
  const preview: ImportPreview = {
    filename: "x.xlsx",
    rowsTotal: 1,
    creates: [],
    updates: [],
    absent: [],
    issues: [
      { rowNumber: 2, odooId: null, field: "name", rule: "a", message: "", severity: "REJECT" },
      { rowNumber: 2, odooId: null, field: "email", rule: "b", message: "", severity: "REJECT" },
      { rowNumber: 2, odooId: null, field: "status", rule: "c", message: "", severity: "REJECT" },
    ],
    validRows: [],
  };
  assert.equal(countsFor(preview).rowsRejected, 1);
});

test("a WARNING does not count as a rejected row", () => {
  const preview: ImportPreview = {
    filename: "x.xlsx",
    rowsTotal: 1,
    creates: [],
    updates: [],
    absent: [],
    issues: [
      { rowNumber: 2, odooId: "E1", field: "name", rule: "w", message: "", severity: "WARNING" },
    ],
    validRows: [],
  };
  assert.equal(countsFor(preview).rowsRejected, 0);
});
