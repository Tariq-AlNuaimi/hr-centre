import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.SALARY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.ID_ENCRYPTION_KEY = randomBytes(32).toString("base64");
delete process.env.ID_ENCRYPTION_KEY_PREVIOUS;

const crypto = await import("../../lib/crypto/field-encryption");
const { encryptIdNumber, readIdNumber, IdDocumentKeyError } =
  await import("../../lib/people/id-documents");
const { employeeCreateData, recordWriteData } = await import("../../lib/people/write");
const { employeeDetailSelect, serializeEmployeeDetail } =
  await import("../../lib/core/employee-select");
const { checkRecord } = await import("../../lib/pms/import/checks/record");
const { employeeRecordSchema, recordFromBody } = await import("../../lib/validations/people");
const { recordFieldsTouched } = await import("../../lib/people/record");
import type { PmsActor } from "../../lib/core/permissions";
import type { EmployeeSourceRow } from "../../lib/pms/import/types";

/**
 * HR Centre foundation F-b — the full employee record (blueprint §2,
 * AC-F2.1–AC-F2.3, AC-F5.2).
 */

const actor = (pmsRoles: PmsActor["pmsRoles"], isLineManager = false): PmsActor => ({
  userId: "u1",
  employeeId: "e1",
  pmsRoles,
  isLineManager,
});

test("AC-F2.2: ID numbers use their OWN key — the salary key cannot open them", () => {
  const envelope = encryptIdNumber("12345678", "ODOO-1")!;
  assert.ok(crypto.isEncryptedEnvelope(envelope));
  assert.ok(!envelope.includes("12345678"));
  assert.deepEqual(readIdNumber(envelope, "ODOO-1"), { value: "12345678", unavailable: false });
  assert.throws(() => crypto.decryptField(envelope, "ODOO-1"), crypto.FieldEncryptionError);
  // Bound to the employee: moved to another row it will not open.
  assert.equal(readIdNumber(envelope, "ODOO-2").unavailable, true);
});

test("worst path: a missing ID key fails writes closed and reads degrade per field", () => {
  const envelope = encryptIdNumber("P1234567", "ODOO-1")!;
  const saved = process.env.ID_ENCRYPTION_KEY;
  delete process.env.ID_ENCRYPTION_KEY;
  crypto.resetKeyCacheForTests();
  try {
    assert.throws(() => encryptIdNumber("P1", "ODOO-1"), IdDocumentKeyError);
    assert.deepEqual(readIdNumber(envelope, "ODOO-1"), { value: null, unavailable: true });
    // Salary is unaffected — the two keys are independent.
    assert.ok(crypto.encryptField("100", "ODOO-1"));
  } finally {
    process.env.ID_ENCRYPTION_KEY = saved;
    crypto.resetKeyCacheForTests();
  }
});

test("AC-F2.2/F2.3: the detail select carries personal and ID columns only for HR", () => {
  const manager = employeeDetailSelect(actor([], true)) as Record<string, unknown>;
  assert.equal("dateOfBirth" in manager, false, "line managers never select personal fields");
  assert.equal("civilIdNumberEnc" in manager, false);
  assert.equal("jobTitle" in manager, true, "job and contact are for every viewer");
  assert.equal("workPhone" in manager, true);
  const exec = employeeDetailSelect(actor(["EXECUTIVE_VIEWER"])) as Record<string, unknown>;
  assert.equal("dateOfBirth" in exec, false, "org-wide performance read ≠ personal data");
  const hr = employeeDetailSelect(actor(["HRBP"])) as Record<string, unknown>;
  assert.equal("dateOfBirth" in hr, true);
  assert.equal("civilIdNumberEnc" in hr, true);
});

const baseRow = {
  id: "e1",
  odooId: "ODOO-1",
  name: "A",
  email: "a@rihal.om",
  roleTrack: "INDIVIDUAL",
  status: "ACTIVE",
  dateOfJoining: null,
  managerId: null,
  department: { id: "d1", name: "Data", directorate: { id: "dir1", name: "Technology" } },
  entity: { id: "rihal", code: "RIHAL", name: "Rihal" },
  manager: null,
  jobTitle: "Analyst",
  gradeRef: null,
  contractType: "PERMANENT",
  probationEndDate: new Date("2026-04-01T00:00:00Z"),
  workLocation: null,
  workPhone: null,
};

test("serializeEmployeeDetail omits gated groups and opens ID numbers when selected", () => {
  const plain = serializeEmployeeDetail(baseRow);
  assert.equal(plain.record.personal, undefined);
  assert.equal(plain.record.idDocuments, undefined);
  assert.equal(plain.record.directorate?.name, "Technology");
  assert.equal(plain.record.probationEndDate, "2026-04-01");

  const full = serializeEmployeeDetail({
    ...baseRow,
    personalEmail: null,
    personalPhone: null,
    dateOfBirth: new Date("1990-05-02T00:00:00Z"),
    gender: "FEMALE",
    nationality: "Omani",
    civilIdNumberEnc: encryptIdNumber("12345678", "ODOO-1"),
    civilIdExpiry: null,
    passportNumberEnc: "v1.AAAA.BBBB.CCCC",
    passportExpiry: null,
  });
  assert.equal(full.record.personal?.dateOfBirth, "1990-05-02");
  assert.equal(full.record.idDocuments?.civilIdNumber, "12345678");
  assert.equal(full.record.idDocuments?.passportNumber, null);
  assert.equal(
    full.record.idDocuments?.unavailable,
    true,
    "a bad envelope says so, nothing else breaks",
  );
});

test("the writer: absent = untouched, null = cleared, ID numbers only ever as ciphertext", () => {
  assert.deepEqual(recordWriteData({}, "ODOO-1"), {});
  const data = recordWriteData({ jobTitle: null, civilIdNumber: "12345678" }, "ODOO-1");
  assert.equal(data.jobTitle, null);
  assert.equal("civilIdNumber" in data, false, "no plaintext column exists to write");
  assert.equal(readIdNumber(data.civilIdNumberEnc as string, "ODOO-1").value, "12345678");
  assert.equal(recordWriteData({ passportNumber: null }, "ODOO-1").passportNumberEnc, null);
});

function sourceRow(over: Partial<EmployeeSourceRow>): EmployeeSourceRow {
  return {
    rowNumber: 2,
    odooId: "E1",
    name: "A",
    email: "a@rihal.om",
    dateOfJoining: null,
    department: "Data",
    entity: "Rihal",
    managerOdooId: "B",
    roleTrack: "Individual",
    basicSalary: null,
    status: "Active",
    lastWorkingDay: null,
    unpaidLeaveDays: "0",
    ...over,
  };
}

test("import: absent columns are left alone, blanks clear, bad values name the field", () => {
  assert.deepEqual(checkRecord(sourceRow({})), { value: {}, issues: [] });
  const ok = checkRecord(
    sourceRow({
      jobTitle: "Analyst",
      contractType: "fixed term",
      gender: "F",
      dateOfBirth: "1990-05-02",
      civilIdNumber: "1234 5678",
      grade: null,
    }),
  );
  assert.equal(ok.issues.length, 0);
  assert.equal(ok.value.contractType, "FIXED_TERM");
  assert.equal(ok.value.gender, "FEMALE");
  assert.equal(ok.value.civilIdNumber, "12345678");
  assert.equal(ok.value.grade, null);
  assert.equal(ok.value.dateOfBirth?.toISOString().slice(0, 10), "1990-05-02");

  const bad = checkRecord(
    sourceRow({ passportNumber: "!!", dateOfBirth: "2999-01-01", gender: "x" }),
  );
  assert.deepEqual(bad.issues.map((i) => i.field).sort(), [
    "dateOfBirth",
    "gender",
    "passportNumber",
  ]);
  assert.ok(
    bad.issues.every((i) => !i.message.includes("!!")),
    "an ID-number rejection never echoes the value",
  );
});

test("AC-F2.1: form validation names the field and why", () => {
  const r = employeeRecordSchema.safeParse({ personalEmail: "nope", civilIdNumber: "#" });
  assert.equal(r.success, false);
  const paths = r.error!.issues.map((i) => i.path.join("."));
  assert.deepEqual(paths.sort(), ["civilIdNumber", "personalEmail"]);
  assert.equal(
    employeeRecordSchema.safeParse({ salary: "1" }).success,
    false,
    "unknown keys refused",
  );
  const parsed = recordFromBody(
    employeeRecordSchema.parse({ jobTitle: "", civilIdExpiry: "2030-01-31" }),
  );
  assert.equal(parsed.jobTitle, null, "an empty box clears");
  assert.equal(parsed.civilIdExpiry?.toISOString().slice(0, 10), "2030-01-31");
  assert.equal("grade" in parsed, false, "an absent box stays absent");
});

test("writing personal or ID fields is detected so the route can demand the permission", () => {
  assert.deepEqual(recordFieldsTouched({ jobTitle: "x" }), { personal: false, idDocuments: false });
  assert.deepEqual(recordFieldsTouched({ gender: null }), { personal: true, idDocuments: false });
  assert.deepEqual(recordFieldsTouched({ passportExpiry: null }), {
    personal: false,
    idDocuments: true,
  });
});

test("AC-F5.2: the import and the form produce the same row through the one writer", () => {
  const imported = checkRecord(sourceRow({ jobTitle: "Analyst", workPhone: "+968 9000 0000" }));
  const typed = recordFromBody(
    employeeRecordSchema.parse({ jobTitle: "Analyst", workPhone: "+968 9000 0000" }),
  );
  const core = {
    odooId: "E1",
    name: "A",
    email: "a@rihal.om",
    departmentId: "d1",
    teamId: null,
    entityId: "rihal",
    roleTrack: "INDIVIDUAL" as const,
    basicSalary: null,
    status: "ACTIVE" as const,
    dateOfJoining: null,
    lastWorkingDay: null,
    unpaidLeaveDays: 0,
  };
  assert.deepEqual(
    employeeCreateData(core, imported.value, { userId: null }),
    employeeCreateData(core, typed, { userId: null }),
  );
});
