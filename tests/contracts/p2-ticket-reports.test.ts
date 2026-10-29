import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ageBand, csvField, toCsv } from "../../lib/hive/services/report-sla";
import { queueWhere } from "../../lib/hive/services/escalation-read";
import { escalationQuerySchema } from "../../lib/validations/hive/escalation-queue";

/** P2-10 — ticket reports (docs/blueprints/p2-ticket-reports.md). */

const NOW = new Date("2026-10-29T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

test("AC-3.1 ageing bands by whole days open", () => {
  assert.equal(ageBand(ago(0), NOW), "0-2");
  assert.equal(ageBand(ago(2.9), NOW), "0-2");
  assert.equal(ageBand(ago(3), NOW), "3-7");
  assert.equal(ageBand(ago(8), NOW), "8-14");
  assert.equal(ageBand(ago(15), NOW), "15+");
});

test("AC-5.1 CSV: service-level columns only, formula injection neutralised", () => {
  assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvField('a,"b"'), '"a,""b"""');
  const csv = toCsv(
    [
      {
        ticketNumber: 7,
        status: "SENT",
        source: "HIVE",
        createdAt: new Date("2026-10-01T08:00:00Z"),
        firstResponseAt: new Date("2026-10-01T10:00:00Z"),
        submittedAt: new Date("2026-10-02T08:00:00Z"),
        approvedAt: new Date("2026-10-02T11:00:00Z"),
        sentAt: new Date("2026-10-02T12:00:00Z"),
        dueAt: new Date("2026-10-03T08:00:00Z"),
        hrPair: { name: "Pair A" },
        assignee: { name: "Huda" },
      },
    ],
    "HR",
  );
  const [header, row] = csv.trim().split("\r\n");
  assert.doesNotMatch(header, /email|question|employee/);
  assert.equal(
    row,
    "HR-0007,SENT,HIVE,Pair A,Huda,2026-10-01T08:00:00.000Z,2026-10-03T08:00:00.000Z,2026-10-01T10:00:00.000Z,2026-10-02T12:00:00.000Z,2,28,3,yes",
  );
  const sla = readFileSync("lib/hive/services/report-sla.ts", "utf8");
  assert.doesNotMatch(sla, /employeeEmail: true|question: true|employeeName: true/);
});

test("AC-4.1 per-person click-through filters the queue by assignee", () => {
  const parsed = escalationQuerySchema.parse({ assigneeId: "u1" });
  assert.equal(parsed.assigneeId, "u1");
  assert.deepEqual(queueWhere({ assigneeId: "u1" }), { assigneeId: "u1" });
  const page = readFileSync("app/[locale]/(dashboard)/tickets/(queue)/page.tsx", "utf8");
  assert.match(page, /filtersFromUrl\(/);
  assert.match(page, /params\.set\("assigneeId", filters\.assigneeId\)/);
});

test("AC-1.1 the report carries first response, resolution, target, approval, backlog, ageing, people", () => {
  const src = readFileSync("lib/hive/services/reports.ts", "utf8");
  for (const k of ["slaFigures(range)", "backlogTrend(", "ageing(new Date())", "perPerson(range"]) {
    assert.ok(src.includes(k), k);
  }
  const sla = readFileSync("lib/hive/services/report-sla.ts", "utf8");
  assert.match(sla, /"sentAt" <= "due_at"/);
  assert.match(sla, /"approvedAt" - "submittedAt"/);
  assert.match(sla, /"first_response_at" - "createdAt"/);
});

test("AC-5.1 the CSV route is guarded like the report and rate-limited", () => {
  const src = readFileSync("app/api/hive/admin/reports/export/route.ts", "utf8");
  assert.match(src, /withRateLimit\(\s*withAuth\(\s*requireHivePermission\("viewReports"/);
  assert.match(src, /text\/csv/);
});
