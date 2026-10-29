import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DOCUMENT_TASK_CODE,
  INTRO_TASK_CODE,
  PHOTO_TASK_CODE,
  linkExpiry,
  photoPathname,
  preboardingBlockedReason,
  readDocuments,
  reminderDue,
} from "../../lib/jml/preboarding/rules";
import {
  preboardingSubmitSchema,
  preboardingTokenSchema,
} from "../../lib/validations/jml/preboarding";
import { isPublicApiPath, isPublicPath } from "../../i18n/route-decision";
import { DEFAULT_SCHEDULE } from "../../lib/working-time/calendar";

/** P2-4 — joiner preboarding (docs/blueprints/p2-preboarding.md, ADR-093). */

const DAY = 86_400_000;
const NOW = new Date("2027-03-01T08:00:00Z");

test("AC-1.2 a link ends with the planned start day, between 3 and 60 days out", () => {
  const start = new Date("2027-03-20T00:00:00Z");
  assert.deepEqual(linkExpiry(NOW, start), new Date("2027-03-21T00:00:00Z"));
  assert.deepEqual(linkExpiry(NOW, null), new Date(NOW.getTime() + 60 * DAY));
  assert.deepEqual(linkExpiry(NOW, new Date("2027-09-01")), new Date(NOW.getTime() + 60 * DAY));
  assert.deepEqual(linkExpiry(NOW, new Date("2027-03-01")), new Date(NOW.getTime() + 3 * DAY));
});

test("AC-1.1 only an open onboarding of someone who has not started gets a link", () => {
  const ok = { caseType: "JOIN", status: "ACTIVE", employeeStatus: "PRE_JOINER" };
  assert.equal(preboardingBlockedReason(ok), null);
  assert.equal(preboardingBlockedReason({ ...ok, status: "DRAFT" }), null);
  assert.notEqual(preboardingBlockedReason({ ...ok, caseType: "LEAVE" }), null);
  for (const status of ["CANCELLED", "ARCHIVED", "COMPLETED"]) {
    assert.notEqual(preboardingBlockedReason({ ...ok, status }), null, status);
  }
  assert.notEqual(preboardingBlockedReason({ ...ok, employeeStatus: "ACTIVE" }), null);
});

test("AC-4.1 reminders fall 10, 5 and 2 working days before the start, once a day", () => {
  const calendar = { schedule: DEFAULT_SCHEDULE, holidays: new Set<string>() };
  // Start Sun 21 Mar 2027. Working days Sun–Thu.
  const start = new Date("2027-03-21T00:00:00Z");
  const due = (today: string, last: Date | null = null) =>
    reminderDue({
      today: new Date(today),
      plannedStart: start,
      lastReminderAt: last,
      startOfToday: new Date(today),
      calendar,
    });
  // 2 working days before Sun 21: Wed 17 → Thu 18 (1), Sun 21 (2).
  assert.equal(due("2027-03-17T00:00:00Z"), true);
  assert.equal(due("2027-03-18T00:00:00Z"), false);
  assert.equal(
    due("2027-03-17T00:00:00Z", new Date("2027-03-17T06:00:00Z")),
    false,
    "already reminded today",
  );
  assert.equal(due("2027-03-21T00:00:00Z"), false, "start day itself");
});

test("AC-3.1/3.2 the form completes T08/T09 only; documents map to T04–T07 notes", () => {
  assert.equal(PHOTO_TASK_CODE, "T08");
  assert.equal(INTRO_TASK_CODE, "T09");
  assert.deepEqual(Object.values(DOCUMENT_TASK_CODE), ["T04", "T05", "T06", "T07"]);
  const src = readFileSync("lib/jml/preboarding/joiner.ts", "utf8");
  // Document answers are notes, never completions.
  assert.doesNotMatch(src, /completeByCode\([^)]*DOCUMENT_TASK_CODE/);
  assert.match(src, /noteOnCode\(\s*tx,\s*caseId,\s*DOCUMENT_TASK_CODE\[doc\]/);
  // System completion respects the task gates.
  assert.match(src, /canCompleteTask\(task, all\)\.allowed/);
});

test("AC-2.2 the form schema is strict, bounded and has no ID number field", () => {
  assert.equal(
    preboardingSubmitSchema.safeParse({ introSentence: "x".repeat(501) }).success,
    false,
  );
  assert.equal(preboardingSubmitSchema.safeParse({ civilIdNumber: "123" }).success, false);
  assert.equal(
    preboardingSubmitSchema.safeParse({ documents: { CIVIL_ID: "LOST" } }).success,
    false,
  );
  const parsed = preboardingSubmitSchema.parse({
    introSentence: "  Hello  ",
    hobbies: "",
    documents: { PASSPORT: "WILL_BRING" },
  });
  assert.equal(parsed.introSentence, "Hello");
  assert.equal(parsed.hobbies, null);
  assert.equal(preboardingTokenSchema.safeParse("short").success, false);
  assert.equal(preboardingTokenSchema.safeParse("a".repeat(43)).success, true);
});

test("readDocuments keeps known keys and answers only", () => {
  assert.deepEqual(readDocuments({ CIVIL_ID: "SENT", PASSPORT: "nope", OTHER: "SENT" }), {
    CIVIL_ID: "SENT",
  });
  assert.deepEqual(readDocuments(null), {});
});

test("the picture lives under one private path per case", () => {
  assert.equal(photoPathname("c1", "image/png"), "jml/preboarding/c1/photo.png");
  assert.equal(photoPathname("c1", "image/jpeg"), "jml/preboarding/c1/photo.jpg");
});

test("ADR-093 exactly three public surfaces are open, and nothing else under them", () => {
  const token = "a".repeat(43);
  assert.equal(isPublicPath(`/preboarding/${token}`), true);
  assert.equal(isPublicPath(`/en/preboarding/${token}`), true);
  assert.equal(isPublicApiPath(`/api/preboarding/${token}`), true);
  assert.equal(isPublicApiPath(`/api/preboarding/${token}/photo`), true);
  assert.equal(isPublicApiPath(`/api/preboarding/${token}/other`), false);
  assert.equal(isPublicApiPath(`/api/jml/cases/x/preboarding`), false);
  const lint = readFileSync("eslint-rules/rules/no-bare-api-route.mjs", "utf8");
  assert.match(lint, /preboarding\[\\\\\/\]\\\[token\\\]\[\\\\\/\]route\\\.ts\$/);
});

test("public routes: per-token limit, token resolved after parsing, private headers", () => {
  for (const f of [
    "app/api/preboarding/[token]/route.ts",
    "app/api/preboarding/[token]/photo/route.ts",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /export const POST = withRateLimit\(/, f);
    assert.match(src, /rateLimit\(tokenScopedRequest\(/, f);
    assert.match(src, /resolvePreboarding\(raw\.data\)/, f);
    assert.match(src, /withPrivateHeaders\(err\("Not found\.", 404\)\)/, f);
  }
});

test("HR routes go through the JML case access check", () => {
  const svc = readFileSync("lib/jml/preboarding/hr.ts", "utf8");
  assert.match(svc, /loadCaseFor\(actor, caseId, "jml\.manageJoiners", "JOIN"\)/);
  assert.match(svc, /loadCaseFor\(actor, caseId, "jml\.view", "JOIN"\)/);
  for (const f of [
    "app/api/jml/cases/[id]/preboarding/route.ts",
    "app/api/jml/cases/[id]/preboarding/photo/route.ts",
  ]) {
    assert.match(readFileSync(f, "utf8"), /withRateLimit\(\s*withAuth\(/, f);
  }
});

test("AC-5.1 anonymising the joiner case deletes the preboarding row and picture", () => {
  const src = readFileSync("lib/jml/join/retention.ts", "utf8");
  assert.match(src, /tx\.jmlPreboarding\.delete\(/);
  assert.match(src, /erasePreboardingPhoto\(/);
});
