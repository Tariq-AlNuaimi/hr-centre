import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { missingActivationFields, readinessProblem } from "../../lib/jml/join/readiness";
import { joinFacts } from "../../lib/jml/join/facts";
import { shiftedDue } from "../../lib/jml/join/start-shift";
import { retentionConfig } from "../../lib/jml/join/retention-config";
import { statutoryRisk } from "../../lib/jml/watch/risk";
import { monthBuckets } from "../../lib/jml/reports/months";
import { isRetryable, itIntakeConfig } from "../../lib/jml/desks";
import { taskApplies } from "../../lib/jml/engine/conditions";
import { generateTasks } from "../../lib/jml/engine/generate";
import {
  isPlaceholderEmail,
  placeholderEmail,
  PLACEHOLDER_EMAIL_DOMAIN,
} from "../../lib/people/provisional-id";
import { STARTER_JOIN_TEMPLATE } from "../../prisma/seed-jml-templates";
import { conditionsSchema } from "../../lib/validations/jml/template";
import { draftJoinerSchema, updateJoinerSchema } from "../../lib/validations/jml/joiner";
import { DEFAULT_CALENDAR, type WorkingCalendar } from "../../lib/working-time/calendar";

/** JML S3 — joiners (HR Onboarding US1–US11; docs/blueprints/jml-s3-joiners.md). */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

const READY = {
  fullName: "Aisha",
  personalEmail: "aisha@example.test",
  nationality: "Omani",
  entityId: "e",
  departmentId: "dep",
  roleTrack: "INDIVIDUAL",
  jobTitle: "Engineer",
  employmentType: "PERMANENT",
  contractTypeId: "ct",
  plannedStartDate: d("2026-11-15"),
  managerId: "m",
  msAccountRequired: true,
  laptopRequired: false,
  accessCardRequired: true,
};

test("AC-NEW-002: every missing activation field is reported at once", () => {
  const missing = missingActivationFields({
    ...READY,
    personalEmail: null,
    jobTitle: "",
    managerId: null,
    laptopRequired: null,
  });
  assert.deepEqual(missing, ["Personal email", "Job title", "Line manager", "Laptop required"]);
  assert.match(readinessProblem({ ...READY, nationality: null })!, /Nationality/);
});

test("an IT answer of `false` is an answer; NULL is not", () => {
  assert.equal(readinessProblem(READY), null);
  assert.deepEqual(missingActivationFields({ ...READY, msAccountRequired: null }), [
    "Microsoft account required",
  ]);
});

test("C-Level joiners need no department (core placement rule)", () => {
  assert.equal(readinessProblem({ ...READY, roleTrack: "C_LEVEL", departmentId: null }), null);
  assert.deepEqual(missingActivationFields({ ...READY, departmentId: null }), ["Department"]);
});

test("§10.2 starter: 36 tasks, unique codes, valid conditions, no compensation fact", () => {
  const tasks = STARTER_JOIN_TEMPLATE.tasks;
  assert.equal(tasks.length, 36);
  assert.equal(new Set(tasks.map((t) => t.code)).size, 36);
  for (const t of tasks) {
    assert.ok(conditionsSchema.safeParse(t.conditions ?? {}).success, t.name);
  }
  const byStage = (s: string) => tasks.filter((t) => t.stage === s).length;
  assert.deepEqual(
    [byStage("PREBOARDING"), byStage("FIRST_DAY"), byStage("FIRST_WEEK")],
    [17, 11, 8],
  );
  assert.ok(!JSON.stringify(STARTER_JOIN_TEMPLATE).toLowerCase().includes("salary"));
});

test("BR-005/006 fixed in the starter: payroll follows Payroll Applicable, visa skips Omani joiners", () => {
  const byName = (part: string) => STARTER_JOIN_TEMPLATE.tasks.find((t) => t.name.includes(part))!;
  const facts = (nationality: string, payroll: boolean) =>
    joinFacts({
      companyCode: "RIHAL",
      employmentType: "PERMANENT",
      contractTypeCode: "UNLIMITED",
      nationality,
      workLocation: null,
      payrollApplicable: payroll,
    });
  const payroll = byName("payroll sheet");
  assert.equal(taskApplies(payroll.conditions, facts("Omani", true)), true);
  assert.equal(taskApplies(payroll.conditions, facts("Omani", false)), false);
  const visa = byName("visa");
  assert.equal(taskApplies(visa.conditions, facts("omani", true)), false, "case-insensitive");
  assert.equal(taskApplies(visa.conditions, facts("Indian", true)), true);
  const mol = byName("MOL");
  assert.equal(taskApplies(mol.conditions, facts("Indian", true)), false);
});

test("the starter generates on the working calendar: no task is due on a weekend or holiday", () => {
  const calendar: WorkingCalendar = { ...DEFAULT_CALENDAR, holidays: new Set(["2026-11-18"]) };
  const defs = STARTER_JOIN_TEMPLATE.tasks.map((t) => ({
    code: t.code,
    name: t.name,
    stage: t.stage,
    sortOrder: t.sortOrder,
    dateBasis: "START_DATE" as const,
    offsetDays: t.offsetDays,
    offsetUnit: "CALENDAR_DAYS" as const,
    mandatory: t.mandatory,
    blocking: false,
    confirmationRequired: false,
    defaultConfirmingParty: null,
    reversalFlag: false,
    dependsOnCodes: [],
    statutory: t.statutory ?? false,
    complianceCategory: t.complianceCategory ?? null,
    conditions: t.conditions ?? {},
    appliesToExitTypes: [],
    appliesToNationality: "ANY" as const,
    appliesToSettlement: null,
  }));
  const tasks = generateTasks(
    defs,
    {
      caseType: "JOIN",
      facts: joinFacts({
        companyCode: "RIHAL",
        employmentType: "PERMANENT",
        contractTypeCode: "UNLIMITED",
        nationality: "Indian",
        workLocation: null,
        payrollApplicable: true,
      }),
      anchors: { START_DATE: d("2026-11-15") },
    },
    calendar,
  );
  assert.equal(tasks.length, 35, "the Omani-only MOL task drops for an expatriate");
  for (const t of tasks) {
    const day = t.dueDate.getUTCDay();
    assert.ok(day !== 5 && day !== 6, `${t.code} due on a weekend`);
    assert.notEqual(iso(t.dueDate), "2026-11-18", `${t.code} due on a holiday`);
  }
  const statutory = tasks.filter((t) => t.statutory);
  assert.ok(statutory.every((t) => iso(t.complianceDeadline) === iso(t.dueDate)));
});

test("change start date: template tasks recompute from their offset; manual ones shift and roll", () => {
  const base = {
    id: "x",
    dueDateOverrideReason: null,
    statutory: false,
  };
  // Template task, -3 calendar days from a Sunday start → Thursday.
  const templ = {
    ...base,
    dateBasis: "START_DATE",
    offsetDays: -3,
    offsetUnit: "CALENDAR_DAYS" as const,
    dueDate: d("2026-11-12"),
  };
  assert.equal(iso(shiftedDue(templ, d("2026-11-22"), 7, DEFAULT_CALENDAR)), "2026-11-19");
  // Manual task moved by +5 days lands on a Friday → rolls to Sunday.
  const manual = {
    ...base,
    dateBasis: null,
    offsetDays: null,
    offsetUnit: null,
    dueDate: d("2026-11-15"),
  };
  assert.equal(iso(shiftedDue(manual, d("2026-11-20"), 5, DEFAULT_CALENDAR)), "2026-11-22");
  // An overridden template date moves by the shift instead of snapping back.
  const overridden = { ...templ, dueDateOverrideReason: "agreed with IT" };
  assert.equal(iso(shiftedDue(overridden, d("2026-11-22"), 7, DEFAULT_CALENDAR)), "2026-11-19");
});

test("statutory watch bands in working days (BR-025)", () => {
  const today = d("2026-11-15"); // Sunday
  assert.deepEqual(statutoryRisk(null, today, DEFAULT_CALENDAR), {
    risk: "no_deadline",
    workingDays: null,
  });
  assert.equal(statutoryRisk(d("2026-11-12"), today, DEFAULT_CALENDAR).risk, "overdue");
  assert.equal(statutoryRisk(d("2026-11-22"), today, DEFAULT_CALENDAR).risk, "due_soon");
  assert.equal(statutoryRisk(d("2026-12-15"), today, DEFAULT_CALENDAR).risk, "scheduled");
});

test("retention refuses to run without an approved period (gate G8)", () => {
  assert.equal(retentionConfig({}).configured, false);
  assert.equal(retentionConfig({ JML_RETENTION_DAYS: "abc" }).configured, false);
  assert.equal(retentionConfig({ JML_RETENTION_DAYS: "0" }).configured, false);
  assert.equal(
    retentionConfig({ JML_RETENTION_DAYS: "365", JML_RETENTION_ACTION: "delete" }).configured,
    false,
  );
  assert.deepEqual(retentionConfig({ JML_RETENTION_DAYS: "365" }), {
    configured: true,
    days: 365,
    action: "anonymise",
  });
});

test("IT intake is off unless URL AND design approval are set; retry policy", () => {
  const saved = { ...process.env };
  try {
    delete process.env.IT_INTAKE_URL;
    assert.equal(itIntakeConfig().enabled, false);
    process.env.IT_INTAKE_URL = "https://it.example.test/intake";
    assert.equal(itIntakeConfig().enabled, false);
    process.env.IT_INTAKE_DESIGN_APPROVED = "true";
    assert.equal(itIntakeConfig().enabled, true);
  } finally {
    process.env = saved;
  }
  assert.equal(isRetryable(null), true);
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(400), false);
});

test("pre-joiner placeholder emails can never be delivered or become logins", () => {
  const email = placeholderEmail();
  assert.ok(email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`));
  assert.ok(isPlaceholderEmail(email));
  assert.ok(!isPlaceholderEmail("aisha@rihal.om"));
  const run = readFileSync("lib/pms/import/run.ts", "utf8");
  assert.match(run, /row\.status === "PRE_JOINER" \|\| isPlaceholderEmail\(row\.email\)/);
});

test("volume trend emits every month from go-live, including empty ones", () => {
  assert.deepEqual(monthBuckets(d("2026-09-20"), d("2026-12-02")), [
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
  ]);
});

test("§13.1: exactly the eight onboarding reports, in order", () => {
  const src = readFileSync("lib/jml/reports/registry.ts", "utf8");
  const list = src.slice(src.indexOf("REPORTS: readonly ReportDefinition[] = ["));
  const order = [...list.slice(0, list.indexOf("];")).matchAll(/^\s+(\w+),$/gm)].map((m) => m[1]);
  assert.deepEqual(order, [
    "monthlyOnboarding",
    "hrWorkload",
    "onboardingCompletion",
    "delayedTasks",
    "upcomingJoiners",
    "completedOnboardings",
    "volumeTrend",
    "allCompanies",
  ]);
});

test("joiner boundary: a draft needs only a name and company; contract dates in order", () => {
  assert.equal(draftJoinerSchema.safeParse({ fullName: "A", entityId: "e" }).success, true);
  assert.equal(draftJoinerSchema.safeParse({ entityId: "e" }).success, false);
  const backwards = updateJoinerSchema.safeParse({
    contractStartDate: "2026-12-01",
    contractEndDate: "2026-11-01",
  });
  assert.equal(backwards.success, false);
  assert.equal(
    draftJoinerSchema.safeParse({ fullName: "A", entityId: "e", salary: "1,500" }).success,
    false,
  );
});

test("no JML joiner column stores ID numbers or bank details (ADR-078)", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const model = schema.slice(schema.indexOf("model JmlJoinDetail {"));
  const body = model.slice(0, model.indexOf("\n}"));
  assert.doesNotMatch(body, /passport|civil|iban|bank|account_number/i);
});
