import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickGrade, unknownGradeMessage } from "../../lib/core/catalogue/grades";
import { recordWriteData } from "../../lib/people/write";
import { checkGrade } from "../../lib/pms/import/checks/record";
import type { ValidationContext } from "../../lib/pms/import/checks/shared";

// ADR-103: an employee's grade is a catalogue row. Writers hand over a CODE and
// resolve it; the import refuses unknown codes with a readable reason.

const grades = [
  { id: "g-own", code: "G3", entityId: "rihal" },
  { id: "g-group", code: "G3", entityId: null },
  { id: "g5", code: "G5", entityId: null },
  { id: "tp4", code: "G4", entityId: "tp" },
];

test("a code resolves to the company's own grade first, then a group-wide one", () => {
  assert.equal(pickGrade(grades, " g3 ", "rihal")?.id, "g-own");
  assert.equal(pickGrade(grades, "G3", "tp")?.id, "g-group");
  assert.equal(pickGrade(grades, "G5", "rihal")?.id, "g5");
  assert.equal(pickGrade(grades, "G4", "rihal"), null, "another company's grade is not offered");
});

test("the refusal names the accepted codes and where new grades come from", () => {
  const m = unknownGradeMessage("X9", "RIHAL", grades, "rihal");
  assert.match(m, /^Grade "X9" is not in the grade catalogue for RIHAL\. Use one of: G3, G5\./);
  assert.match(m, /Hiring › Settings › Library/);
});

const ctx = {
  entitiesByKey: new Map([["rihal", { id: "rihal", code: "RIHAL" }]]),
  grades,
} as unknown as ValidationContext;
const row = { rowNumber: 2 } as Parameters<typeof checkGrade>[0];

test("import: a known code links and takes the catalogue's spelling; unknown is a row issue", () => {
  const record = { grade: "g3" };
  assert.deepEqual(checkGrade(row, record, "rihal", ctx), { value: "g-own", issues: [] });
  assert.equal(record.grade, "G3", "a re-import with the same code is not a change");
  const bad = checkGrade(row, { grade: "X9" }, "rihal", ctx);
  assert.equal(bad.value, undefined);
  assert.equal(bad.issues[0]?.rule, "grade_unknown");
  assert.equal(bad.issues[0]?.severity, "REJECT");
  assert.deepEqual(checkGrade(row, { grade: null }, "rihal", ctx), { value: null, issues: [] });
  assert.deepEqual(checkGrade(row, {}, "rihal", ctx), { value: undefined, issues: [] });
});

test("the writer stores only the link, and refuses an unresolved code", () => {
  assert.deepEqual(recordWriteData({ grade: "G3" }, "E1", "g-own"), { gradeId: "g-own" });
  assert.deepEqual(recordWriteData({ grade: null }, "E1"), { gradeId: null });
  assert.deepEqual(recordWriteData({}, "E1"), {});
  assert.throws(() => recordWriteData({ grade: "G3" }, "E1"), /resolved/);
});

test("the legacy column, its trigger and the old tables are gone", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const employee = /model Employee \{([\s\S]*?)\n\}/.exec(schema)![1];
  assert.doesNotMatch(employee, /\n\s+grade\s+String/);
  assert.doesNotMatch(
    schema,
    /model (JmlHrAssignmentRule|HiringRequisitionApproval|HiringJdSignoff) \{/,
  );
  const sql = readFileSync(
    "prisma/migrations/20261031140000_core_catalogues_only/migration.sql",
    "utf8",
  );
  assert.match(sql, /RAISE EXCEPTION 'ADR-103/);
  assert.match(sql, /DROP TRIGGER IF EXISTS "employees_link_grade"/);
});

test("the email log is admin-only, metadata only, and resends only through a module queue", () => {
  for (const f of ["app/api/email-log/route.ts", "app/api/email-log/[id]/resend/route.ts"])
    assert.match(readFileSync(f, "utf8"), /withRateLimit\(\s*withAdminAuth\(/);
  const log = readFileSync("lib/core/email/log.ts", "utf8");
  assert.doesNotMatch(log, /\bbody\b: true|\btext: true|\bhtml: true/);
  assert.match(log, /RESENDABLE_MODULES = new Set\(\["jml"\]\)/);
});
