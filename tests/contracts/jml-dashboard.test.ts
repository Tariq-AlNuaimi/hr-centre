import test from "node:test";
import assert from "node:assert/strict";

import { BUCKET_ORDER, defaultMine, workBucket } from "../../lib/jml/dashboard-rules";
import { RECORD_TABS } from "../../components/people/RecordTabs";

/** JML S7 — dashboard, my tasks, the record tab. */

const d = (s: string) => new Date(`${s}T00:00:00Z`);

test("AC-13.1 my work buckets against today in the schedule's zone", () => {
  const today = d("2026-10-27");
  assert.equal(workBucket(d("2026-10-26"), today), "OVERDUE");
  assert.equal(workBucket(d("2026-10-27"), today), "DUE_TODAY");
  assert.equal(workBucket(d("2026-10-28"), today), "DUE_TOMORROW");
  assert.equal(workBucket(d("2026-11-02"), today), "FUTURE");
  assert.equal(workBucket(null, today), "NO_DATE");
  assert.ok(
    BUCKET_ORDER.OVERDUE < BUCKET_ORDER.DUE_TODAY && BUCKET_ORDER.FUTURE < BUCKET_ORDER.NO_DATE,
  );
});

test("AC-13.5 a case owner sees their own cases by default; a supervisor everything in scope", () => {
  assert.equal(defaultMine(false, undefined), true);
  assert.equal(defaultMine(true, undefined), false);
  assert.equal(defaultMine(false, "all"), false);
  assert.equal(defaultMine(true, "mine"), true);
});

test("F-e: the employee record carries a JML tab", () => {
  assert.ok((RECORD_TABS as readonly string[]).includes("jml"));
});
