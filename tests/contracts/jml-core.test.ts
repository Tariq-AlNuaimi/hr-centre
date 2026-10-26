import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_CALENDAR,
  addCalendarDaysRolled,
  addWorkingDays,
  isWithinWindow,
  isWorkingDay,
  nextWindowOpening,
  signedWorkingDays,
  weekendDays,
  workingDaysBetween,
  type WorkingCalendar,
} from "../../lib/working-time/calendar";
import {
  StatutoryParameterMissingError,
  resolve,
  unverifiedAmong,
  type StatutoryRow,
} from "../../lib/statutory/parameters";
import { formatEmployeeCode, parseEmployeeCode } from "../../lib/people/employee-code";
import { isProvisionalOdooId, provisionalOdooId } from "../../lib/people/provisional-id";
import { CONTRACT_TYPES } from "../../lib/validations/people";
import { EXIT_REASON_TAXONOMY, STATUTORY_SEED } from "../../prisma/seed-jml-data";

/**
 * JML S1 — the core every JML case relies on (docs/blueprints/jml.md D1–D4).
 * Fixtures are real 2026 dates: 03-05 Thu · 03-06 Fri · 03-07 Sat · 03-08 Sun.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const withHolidays = (...days: string[]): WorkingCalendar => ({
  schedule: DEFAULT_CALENDAR.schedule,
  holidays: new Set(days),
});

test("ADR-077: the default week is Sun–Thu; Friday and Saturday are the weekend", () => {
  assert.deepEqual(weekendDays(DEFAULT_CALENDAR.schedule), [5, 6]);
  assert.equal(isWorkingDay(d("2026-03-06")), false);
  assert.equal(isWorkingDay(d("2026-03-07")), false);
  assert.equal(isWorkingDay(d("2026-03-08")), true, "Sunday is a working day in Oman");
});

test("ADR-077: a public holiday is a non-working day for every calculation", () => {
  const cal = withHolidays("2026-03-08");
  assert.equal(isWorkingDay(d("2026-03-08"), cal), false);
  // Thursday + 1 working day skips the weekend AND the Sunday holiday.
  assert.equal(iso(addWorkingDays(d("2026-03-05"), 1, cal)), "2026-03-09");
  assert.equal(workingDaysBetween(d("2026-03-05"), d("2026-03-09"), cal), 1);
});

test("Offboarding semantics: working-day offsets, n = 0 snaps forward, negatives step back", () => {
  assert.equal(iso(addWorkingDays(d("2026-03-05"), 0)), "2026-03-05");
  assert.equal(iso(addWorkingDays(d("2026-03-06"), 0)), "2026-03-08");
  assert.equal(iso(addWorkingDays(d("2026-03-08"), -1)), "2026-03-05");
  assert.equal(iso(addWorkingDays(d("2026-03-05"), 2)), "2026-03-09");
});

test("Onboarding semantics: calendar offsets roll forward off a day off, also for negatives", () => {
  // 2026-03-15 (Sun) − 9 calendar days = 03-06 (Fri) → rolled forward to Sun 03-08.
  assert.equal(iso(addCalendarDaysRolled(d("2026-03-15"), -9)), "2026-03-08");
  assert.equal(iso(addCalendarDaysRolled(d("2026-03-08"), 2)), "2026-03-10");
});

test("workingDaysBetween counts after `from` up to and including `to`, never negative", () => {
  assert.equal(workingDaysBetween(d("2026-03-05"), d("2026-03-05")), 0);
  assert.equal(workingDaysBetween(d("2026-03-05"), d("2026-03-08")), 1);
  assert.equal(workingDaysBetween(d("2026-03-08"), d("2026-03-05")), 0);
  assert.equal(signedWorkingDays(d("2026-03-08"), d("2026-03-05")), -1);
});

test("F2 fixed: the send window is evaluated in Asia/Muscat, not UTC", () => {
  // 05:00 UTC on Sunday = 09:00 Muscat: inside the window (the cron's hour).
  assert.equal(isWithinWindow(new Date("2026-03-08T05:00:00Z")), true);
  // 14:00 UTC = 18:00 Muscat: outside; next opening Monday 08:00 Muscat = 04:00 UTC.
  assert.equal(
    nextWindowOpening(new Date("2026-03-08T14:00:00Z")).toISOString(),
    "2026-03-09T04:00:00.000Z",
  );
  // Thursday evening → Sunday morning (weekend skipped).
  assert.equal(
    nextWindowOpening(new Date("2026-03-05T15:00:00Z")).toISOString(),
    "2026-03-08T04:00:00.000Z",
  );
  // A holiday Sunday pushes the opening to Monday.
  assert.equal(
    nextWindowOpening(new Date("2026-03-05T15:00:00Z"), withHolidays("2026-03-08")).toISOString(),
    "2026-03-09T04:00:00.000Z",
  );
});

test("a schedule with no working days throws instead of looping", () => {
  const none: WorkingCalendar = {
    schedule: { ...DEFAULT_CALENDAR.schedule, workingDays: [] },
    holidays: new Set(),
  };
  assert.throws(() => addWorkingDays(d("2026-03-05"), 1, none));
  assert.throws(() => nextWindowOpening(new Date(), none));
});

test("D4: statutory parameters resolve half-open, latest row wins, missing throws 422", () => {
  const rows: StatutoryRow[] = [
    {
      key: "gratuity.daysInMonth",
      value: "30",
      effectiveFrom: d("1970-01-01"),
      effectiveTo: null,
      verified: false,
    },
    {
      key: "gratuity.daysInMonth",
      value: "31",
      effectiveFrom: d("2027-01-01"),
      effectiveTo: null,
      verified: true,
    },
  ];
  assert.equal(resolve(rows, "gratuity.daysInMonth", d("2026-12-31")).value, 30);
  assert.equal(resolve(rows, "gratuity.daysInMonth", d("2027-01-01")).value, 31);
  const missing = () => resolve(rows, "settlement.paymentWindowDays", d("2026-01-01"));
  assert.throws(missing, StatutoryParameterMissingError);
  assert.deepEqual(unverifiedAmong([resolve(rows, "gratuity.daysInMonth", d("2026-01-01"))]), [
    "gratuity.daysInMonth",
  ]);
});

test("D4: the seven seeded statutory rows are all unverified, and O2 is NOT seeded", () => {
  assert.equal(STATUTORY_SEED.length, 7);
  assert.ok(STATUTORY_SEED.every((r) => /UNVERIFIED/.test(r.note)));
  assert.ok(!STATUTORY_SEED.some((r) => r.key === "gratuity.summaryDismissal.entitlementFactor"));
  const split = STATUTORY_SEED.find((r) => r.key === "gratuity.postSplit.daysPerYear");
  assert.equal(split?.effectiveFrom.toISOString().slice(0, 10), "2023-07-31");
});

test("§12.3: the seeded reason taxonomy is 7 categories and 35 codes", () => {
  const codes = Object.values(EXIT_REASON_TAXONOMY).flat();
  assert.equal(Object.keys(EXIT_REASON_TAXONOMY).length, 7);
  assert.equal(codes.length, 35);
  assert.equal(new Set(codes.map((c) => c.code)).size, 35);
});

test("BR-003: EMP codes are prefix + zero-padded digits, parsed strictly", () => {
  assert.equal(formatEmployeeCode("EMP", 4, 312), "EMP0312");
  assert.equal(parseEmployeeCode("EMP", 4, "EMP0311"), 311);
  assert.equal(parseEmployeeCode("EMP", 4, "EMP 311"), null);
  assert.equal(parseEmployeeCode("EMP", 4, "emp0311"), null);
  assert.equal(parseEmployeeCode("EMP", 4, "EMP00311"), null);
});

test("ADR-075: provisional Odoo ids are namespaced and recognisable", () => {
  const id = provisionalOdooId();
  assert.match(id, /^PENDING-[0-9a-f]{18}$/);
  assert.ok(isProvisionalOdooId(id));
  assert.ok(!isProvisionalOdooId("1042"));
});

test("ADR-076: one employment-type list — the union of the three sources", () => {
  const onboarding = ["PERMANENT", "PART_TIME", "INTERN", "SUMMER_INTERN", "FREELANCER"];
  const more = ["CONSULTANT", "CONTRACTOR", "TEMPORARY", "TRAINEE", "FIXED_TERM", "SECONDMENT"];
  for (const t of [...onboarding, ...more]) assert.ok(CONTRACT_TYPES.includes(t as never), t);
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const block = /enum ContractType \{([\s\S]*?)\}/.exec(schema)![1]!;
  const values = block.match(/^\s+([A-Z_]+)\s*$/gm)!.map((v) => v.trim());
  assert.deepEqual([...values].sort(), [...CONTRACT_TYPES].sort());
});

test("ADR-075: the core People forms can neither create nor leave PRE_JOINER", () => {
  const route = readFileSync("app/api/employees/[id]/route.ts", "utf8");
  assert.match(route, /\(next === "PRE_JOINER"\) !== \(current === "PRE_JOINER"\)/);
  const schema = readFileSync("lib/validations/employee.ts", "utf8");
  assert.match(schema, /status: z\.enum\(CREATABLE_STATUSES\)/);
});
