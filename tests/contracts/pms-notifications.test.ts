import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BODY_CHARS,
  changeRequestDedupeKey,
  hrDigestDedupeKey,
  ladderDedupeKey,
  notificationKindFor,
  threeSixtyDedupeKey,
} from "../../lib/pms/notifications";
import { markReadSchema, MAX_MARK_READ_IDS } from "../../lib/validations/notification";

/**
 * The in-app channel for §5.5's ladder. Everything asserted here is a decision
 * a screenshot cannot check: WHICH notification is the same notification.
 *
 * The dedupe key is the whole idempotency story — the sweep runs daily against
 * the same unresolved miss, and the difference between "told once" and "told
 * every morning until you resign" is entirely this string.
 */

const base = {
  cycleId: "cyc1",
  stageKind: "GOAL_SETTING",
  subjectEmployeeId: "emp1",
  kind: "DEADLINE_MISSED" as const,
  deadlineISO: "2026-12-31T00:00:00.000Z",
  recipientEmployeeId: "mgr1",
};

test("the same event on the same deadline is the same notification", () => {
  assert.equal(ladderDedupeKey(base), ladderDedupeKey({ ...base }));
});

test("HR extending the deadline produces a NEW notification", () => {
  // §5.5's third rung lets HR extend. The compliance row's own unique key
  // includes `measuredAgainstDeadline` for exactly this reason (see the note on
  // that column in schema.prisma); the notification inherits it, so the second
  // miss is told rather than swallowed as a duplicate of the first.
  const extended = ladderDedupeKey({ ...base, deadlineISO: "2027-01-31T00:00:00.000Z" });
  assert.notEqual(extended, ladderDedupeKey(base));
});

test("one event fans out to several people, and each is told once", () => {
  const toManager = ladderDedupeKey(base);
  const toSkipLevel = ladderDedupeKey({ ...base, recipientEmployeeId: "skip1" });
  assert.notEqual(toManager, toSkipLevel);
});

test("the four rungs are distinct notifications, not one overwritten row", () => {
  const kinds = [
    "REMINDER_SENT",
    "DEADLINE_MISSED",
    "ESCALATED_SKIP_LEVEL",
    "ESCALATED_HR",
  ] as const;
  const keys = new Set(kinds.map((kind) => ladderDedupeKey({ ...base, kind })));
  assert.equal(keys.size, kinds.length);
});

test("a different subject is a different notification, even for the same manager", () => {
  // A manager who missed deadlines for two of their reports has two misses.
  const other = ladderDedupeKey({ ...base, subjectEmployeeId: "emp2" });
  assert.notEqual(other, ladderDedupeKey(base));
});

test("only the first rung reads as a reminder; everything else is an escalation", () => {
  assert.equal(notificationKindFor("REMINDER_SENT"), "CYCLE_REMINDER");
  for (const kind of ["DEADLINE_MISSED", "ESCALATED_SKIP_LEVEL", "ESCALATED_HR"] as const) {
    assert.equal(notificationKindFor(kind), "CYCLE_ESCALATION");
  }
});

test("§9.7's daily reminders collapse to one notification per assignment deadline", () => {
  const monday = threeSixtyDedupeKey("a1", "2026-12-01T00:00:00.000Z");
  const tuesday = threeSixtyDedupeKey("a1", "2026-12-01T00:00:00.000Z");
  // The sweep re-sends this reminder by EMAIL every day inside the window
  // (§9.7 asks for reminders, plural). The feed must not accumulate a copy a
  // day, or it stops being read before the deadline it exists to protect.
  assert.equal(monday, tuesday);
  // ...but an HR-moved 360 deadline is a new fact and is told again.
  assert.notEqual(monday, threeSixtyDedupeKey("a1", "2026-12-08T00:00:00.000Z"));
});

test("the HR digest is per DAY, because its counts move", () => {
  assert.equal(hrDigestDedupeKey("2026-08-28", "hr1"), hrDigestDedupeKey("2026-08-28", "hr1"));
  assert.notEqual(hrDigestDedupeKey("2026-08-28", "hr1"), hrDigestDedupeKey("2026-08-29", "hr1"));
  assert.notEqual(hrDigestDedupeKey("2026-08-28", "hr1"), hrDigestDedupeKey("2026-08-28", "hr2"));
});

test("§6.2 a change-request key is per RECIPIENT, because the HR step fans out", () => {
  // `dedupeKey` is globally unique, not unique per person. The acknowledged
  // step notifies every HR user at once, so a key without the recipient meant
  // the first insert won and every other HR user's row collided on P2002 and
  // was counted as an already-sent duplicate: one arbitrary HR user heard that
  // a request was ready to decide, and the `catch` around the call reported
  // nothing. The same request, the same step, two recipients, two keys.
  const a = changeRequestDedupeKey("cr1", "acknowledged", "hr1");
  const b = changeRequestDedupeKey("cr1", "acknowledged", "hr2");
  assert.notEqual(a, b);
  // Still idempotent for ONE recipient — the point of the key in the first place.
  assert.equal(a, changeRequestDedupeKey("cr1", "acknowledged", "hr1"));
  // And the two steps stay apart, so acknowledging does not suppress the raise.
  assert.notEqual(a, changeRequestDedupeKey("cr1", "raised", "hr1"));
  assert.notEqual(a, changeRequestDedupeKey("cr2", "acknowledged", "hr1"));
});

test("a ladder key can never collide with a 360 key or an HR digest key", () => {
  const prefixes = new Set([
    ladderDedupeKey(base).split(":")[0],
    threeSixtyDedupeKey("a1", "2026-12-01T00:00:00.000Z").split(":")[0],
    hrDigestDedupeKey("2026-08-28", "hr1").split(":")[0],
  ]);
  assert.equal(prefixes.size, 3);
});

test("body is capped, so a long detail cannot become an unbounded row", () => {
  assert.ok(MAX_BODY_CHARS > 0 && MAX_BODY_CHARS <= 2000);
});

/* -- the mark-read boundary ------------------------------------------------ */

test("mark-read accepts exactly one of ids or all", () => {
  assert.ok(markReadSchema.safeParse({ ids: ["n1"] }).success);
  assert.ok(markReadSchema.safeParse({ all: true }).success);
  assert.ok(!markReadSchema.safeParse({}).success);
  assert.ok(!markReadSchema.safeParse({ ids: ["n1"], all: true }).success);
});

test("mark-read refuses an unknown key rather than silently stripping it", () => {
  // zod's DEFAULT is to strip, which is how `POST /api/users {"role":"ADMIN"}`
  // once returned 201 and created a VIEWER (ADR-070). `strictObject` is what
  // turns a client's misunderstanding into a 400 instead of a lie.
  const result = markReadSchema.safeParse({ all: true, recipientEmployeeId: "someone-else" });
  assert.ok(!result.success);
});

test("mark-read bounds how many ids one call may carry", () => {
  const tooMany = Array.from({ length: MAX_MARK_READ_IDS + 1 }, (_, i) => `n${i}`);
  assert.ok(!markReadSchema.safeParse({ ids: tooMany }).success);
  assert.ok(markReadSchema.safeParse({ ids: tooMany.slice(0, MAX_MARK_READ_IDS) }).success);
});

test("mark-read refuses an empty id list", () => {
  assert.ok(!markReadSchema.safeParse({ ids: [] }).success);
});
