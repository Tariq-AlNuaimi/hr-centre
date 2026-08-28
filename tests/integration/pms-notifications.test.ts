import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma";
import { notify, type WrittenEvent } from "../../lib/pms/cycle-notify";
import { ladderDedupeKey } from "../../lib/pms/notifications";
import { suiteActor, TEST_EMPLOYEE_PREFIX } from "./fixture";

/**
 * The claim this suite exists to prove, against a real database:
 *
 *   **With SMTP unconfigured, §5.5's ladder now reaches people.**
 *
 * That was false until 2026-08-28. `notify()` opened with
 * `if (!isEmailEnabled()) return { skipped: true }`, `isEmailEnabled()` is false
 * on this deployment, and so a correct recipient map was computed every morning
 * and discarded. Every unit test in the world would have passed; the ladder
 * still reached nobody. So this test asserts the thing that actually matters —
 * rows in the database after a run with no mail server — rather than the shape
 * of a function's return value.
 *
 * SMTP is left unconfigured here ON PURPOSE. Do not "fix" this suite by setting
 * `SMTP_HOST`: the no-SMTP path is the path in production.
 */

const SUITE = "notif";
const dbUrl = process.env.DATABASE_URL;
const hasDb = !!dbUrl && !/placeholder|user:password@localhost/.test(dbUrl);
const skip = hasDb ? false : "no DATABASE_URL — integration suite self-skipped";

let managerId = "";
let skipLevelId = "";
let subjectId = "";
/**
 * A literal, not a real cycle id. `notify()` writes no compliance row — the
 * sweep already did that — so the cycle id reaches it only as part of the
 * dedupe key. Fetching a real one would tie this suite to whether the demo
 * cycle happens to be seeded, which has nothing to do with what it tests.
 */
const cycleId = "zztest-cycle";

const DEADLINE = "2026-12-31T00:00:00.000Z";

/** The sweep's clock, passed in rather than read — see compliance.ts's header. */
const NOW = new Date("2027-01-02T06:00:00.000Z");

function event(over: Partial<WrittenEvent> = {}): WrittenEvent {
  return {
    kind: "DEADLINE_MISSED",
    managerEmployeeId: managerId,
    missedByHours: 48,
    detail: "Manager did not draft KPIs before the goal-setting deadline.",
    cycleId,
    subjectEmployeeId: subjectId,
    stageKind: "GOAL_SETTING",
    deadlineISO: DEADLINE,
    isNew: true,
    ...over,
  };
}

before(async () => {
  if (!hasDb) return;
  assert.ok(!process.env.SMTP_HOST, "this suite must run with SMTP unconfigured");

  skipLevelId = await suiteActor(prisma, { suite: SUITE, tag: "skip", name: "ZZ Skip Level" });
  managerId = await suiteActor(prisma, {
    suite: SUITE,
    tag: "mgr",
    name: "ZZ Manager",
    managerId: skipLevelId,
  });
  subjectId = await suiteActor(prisma, {
    suite: SUITE,
    tag: "sub",
    name: "ZZ Subject",
    managerId,
  });

  await prisma.notification.deleteMany({
    where: { recipientEmployee: { odooId: { startsWith: TEST_EMPLOYEE_PREFIX } } },
  });
});

after(async () => {
  if (!hasDb) return;
  await prisma.notification.deleteMany({
    where: { recipientEmployee: { odooId: { startsWith: TEST_EMPLOYEE_PREFIX } } },
  });
});

test("a miss reaches the manager in-app even with no mail server", { skip }, async () => {
  const result = await notify([event()], [], 0, NOW);

  assert.equal(result.skipped, true, "email is off, and the result should say so");
  assert.equal(result.sent, 0);
  // ...and yet somebody was told. This is the whole change.
  assert.equal(result.persisted.written, 1);

  const rows = await prisma.notification.findMany({
    where: { recipientEmployeeId: managerId },
    select: { kind: true, body: true, href: true, readAt: true },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "CYCLE_ESCALATION");
  assert.equal(rows[0].readAt, null, "a new notification is unread");
  assert.equal(rows[0].href, "/goal-setting", "href carries no locale prefix");
});

test("tomorrow's sweep tells nobody twice", { skip }, async () => {
  const again = await notify([event()], [], 0, NOW);
  assert.equal(again.persisted.written, 0);
  // Filtered out before the write, not collided with on it — `duplicates`
  // counts only the narrow race where a concurrent sweep wrote the row between
  // the existence check and the create.
  assert.equal(again.persisted.duplicates, 0);

  const count = await prisma.notification.count({ where: { recipientEmployeeId: managerId } });
  assert.equal(count, 1, "the daily re-run must not accumulate a copy a day");
});

test("a run cut short still tells them tomorrow", { skip }, async () => {
  // The failure this guards, found by the post-push breadth review: the sweep
  // has a 60s ceiling, and it commits every compliance row BEFORE it notifies.
  // A run killed in between leaves the rows written, so the next morning the
  // ladder re-derives the same events and they come back `isNew: false`.
  //
  // While the feed was gated on `isNew`, that meant the skip-level manager this
  // feature exists to reach was never told — permanently, silently, with no
  // retry. The gate now applies to EMAIL only; the in-app channel asks the
  // dedupe index, which outlives the process.
  //
  // Simulated by deleting the notification and re-running with isNew: false,
  // which is exactly the state tomorrow's sweep is in.
  const key = ladderDedupeKey({
    cycleId,
    stageKind: "GOAL_SETTING",
    subjectEmployeeId: subjectId,
    kind: "DEADLINE_MISSED",
    deadlineISO: DEADLINE,
    recipientEmployeeId: managerId,
  });
  await prisma.notification.deleteMany({ where: { dedupeKey: key } });

  const tomorrow = await notify([event({ isNew: false })], [], 0, NOW);
  assert.equal(tomorrow.persisted.written, 1, "an interrupted run must be recoverable");

  const row = await prisma.notification.findUnique({
    where: { dedupeKey: key },
    select: { id: true },
  });
  assert.ok(row);
});

test("a quiet morning writes nothing and asks once", { skip }, async () => {
  // Steady state: every unresolved miss is re-derived daily and every one of
  // them has already been told. That has to cost reads, not writes — the whole
  // reason `persistNotifications` filters before it creates.
  const quiet = await notify([event({ isNew: false })], [], 0, NOW);
  assert.equal(quiet.persisted.written, 0);
  assert.equal(quiet.persisted.duplicates, 0, "already-told rows are filtered, not collided with");
  assert.equal(quiet.persisted.failed, 0);
});

test("HR extending the deadline tells the manager again", { skip }, async () => {
  // §5.5's third rung lets HR extend, and the second miss is a real second miss.
  const extended = await notify([event({ deadlineISO: "2027-01-31T00:00:00.000Z" })], [], 0, NOW);
  assert.equal(extended.persisted.written, 1);

  const count = await prisma.notification.count({ where: { recipientEmployeeId: managerId } });
  assert.equal(count, 2);
});

test(
  "the skip-level manager hears about it, having no task row to find it in",
  { skip },
  async () => {
    await notify([event({ kind: "ESCALATED_SKIP_LEVEL" })], [], 0, NOW);

    const rows = await prisma.notification.findMany({
      where: { recipientEmployeeId: skipLevelId },
      select: { kind: true },
    });
    // §5.5 escalates to them BECAUSE they have "authority to compel action".
    // Before this change they were told nothing, ever, by any channel.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "CYCLE_ESCALATION");
  },
);

test("an ESCALATED_HR event goes to HR's digest, not to the manager", { skip }, async () => {
  const before = await prisma.notification.count({ where: { recipientEmployeeId: managerId } });
  await notify([event({ kind: "ESCALATED_HR" })], [], 0, NOW);
  const after = await prisma.notification.count({ where: { recipientEmployeeId: managerId } });
  assert.equal(after, before, "the manager is not notified twice for one miss");

  const hr = await prisma.notification.findMany({
    where: { kind: "HR_INTERVENTION" },
    select: { recipientEmployeeId: true, href: true },
    take: 50,
  });
  assert.ok(hr.length > 0, "the seeded fixture has HR roles, and they receive the digest");
  assert.ok(hr.every((r) => r.href === "/admin/cycles"));

  const hrPeople = await prisma.employee.findMany({
    where: { status: "ACTIVE", pmsRoles: { hasSome: ["HR_SUPER_ADMIN", "HRBP"] } },
    select: { id: true },
    take: 50,
  });
  const hrIds = new Set(hrPeople.map((p) => p.id));
  assert.ok(hr.every((r) => hrIds.has(r.recipientEmployeeId)));

  await prisma.notification.deleteMany({ where: { kind: "HR_INTERVENTION" } });
});

test("a reminder reads as a reminder, not an escalation", { skip }, async () => {
  await notify([event({ kind: "REMINDER_SENT", missedByHours: null })], [], 0, NOW);
  const row = await prisma.notification.findFirst({
    where: { recipientEmployeeId: managerId, kind: "CYCLE_REMINDER" },
    select: { id: true },
  });
  assert.ok(row, "§5.5's first rung is a reminder, and the feed says so");
});

test("soft-deleting an employee KEEPS their notifications", { skip }, async () => {
  // Discovered by running this, not by reading the schema: `Employee` is a
  // soft-delete model, so `prisma.employee.delete` is rewritten to an UPDATE by
  // the extension and the FK cascade never fires. That is the right outcome —
  // an off-boarded person can be restored from the recycling bin, and their
  // history should come back with them — but it is NOT what `onDelete: Cascade`
  // suggests on a first read, so it is asserted rather than assumed.
  //
  // Safe because §12.1's off-boarding revokes the login: a soft-deleted person
  // cannot sign in to read the feed the rows are still in.
  const leaver = await suiteActor(prisma, { suite: SUITE, tag: "soft", name: "ZZ Soft Deleted" });
  await prisma.notification.create({
    data: {
      recipientEmployeeId: leaver,
      kind: "CYCLE_REMINDER",
      body: "kept through a soft delete",
      dedupeKey: `test:soft:${leaver}`,
    },
    select: { id: true },
  });

  await prisma.employee.delete({ where: { id: leaver } });

  const stillThere = await prisma.notification.count({ where: { recipientEmployeeId: leaver } });
  assert.equal(stillThere, 1);
});

test("a HARD delete cascades, leaving no orphan rows", { skip }, async () => {
  // The FK's own guarantee, exercised through the unfiltered client because the
  // audited one never issues a real DELETE for this model. An orphan here would
  // be a row the read path — which scopes by recipient — could never surface or
  // clean up.
  const { prismaUnfiltered } = await import("../../lib/prisma");
  const doomed = await suiteActor(prisma, { suite: SUITE, tag: "hard", name: "ZZ Hard Deleted" });
  await prisma.notification.create({
    data: {
      recipientEmployeeId: doomed,
      kind: "CYCLE_REMINDER",
      body: "temporary",
      dedupeKey: `test:cascade:${doomed}`,
    },
    select: { id: true },
  });

  await prismaUnfiltered.employee.delete({ where: { id: doomed } });

  const left = await prismaUnfiltered.notification.count({
    where: { recipientEmployeeId: doomed },
  });
  assert.equal(left, 0);
});
