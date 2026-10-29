import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  accessSummary,
  defaultCutoff,
  effectiveCutoff,
  localInputToInstant,
} from "../../lib/jml/leave/cutoff";
import { accessCutoffSchema } from "../../lib/validations/jml/leave";

/** P2-5 — scheduled access cut-off for leavers (docs/blueprints/p2-access-cutoff.md). */

const MUSCAT = "Asia/Muscat"; // UTC+4, no DST

test("AC-1.1 the default cut-off is 17:00 Muscat on the last physical working day", () => {
  assert.deepEqual(
    defaultCutoff(new Date("2027-05-12T00:00:00Z"), MUSCAT),
    new Date("2027-05-12T13:00:00Z"),
  );
  assert.equal(defaultCutoff(null, MUSCAT), null);
});

test("AC-1.2 HR's explicit instant wins over the default", () => {
  const lpwd = new Date("2027-05-12T00:00:00Z");
  const explicit = new Date("2027-05-10T06:00:00Z");
  assert.deepEqual(
    effectiveCutoff({ accessCutoffAt: explicit, lastPhysicalWorkingDay: lpwd }, MUSCAT),
    explicit,
  );
  assert.deepEqual(
    effectiveCutoff({ accessCutoffAt: null, lastPhysicalWorkingDay: lpwd }, MUSCAT),
    new Date("2027-05-12T13:00:00Z"),
  );
});

test("AC-1.2 HR enters wall-clock time in the organisation's zone", () => {
  assert.deepEqual(
    localInputToInstant("2027-05-12T18:30", MUSCAT),
    new Date("2027-05-12T14:30:00Z"),
  );
  assert.equal(localInputToInstant("2027-13-12T18:30", MUSCAT), null);
  assert.equal(localInputToInstant("12/05/2027 18:30", MUSCAT), null);
  assert.equal(accessCutoffSchema.safeParse({ at: "2027-05-12T18:30" }).success, true);
  assert.equal(accessCutoffSchema.safeParse({ at: null }).success, true);
  assert.equal(accessCutoffSchema.safeParse({ at: "tomorrow" }).success, false);
});

test("AC-2.1 the Access summary counts done and overdue per system type", () => {
  const today = new Date("2027-05-12T00:00:00Z");
  const rows = accessSummary(
    [
      {
        domain: "IDENTITY",
        dueDate: new Date("2027-05-10"),
        confirmedDate: new Date("2027-05-10"),
      },
      { domain: "IDENTITY", dueDate: new Date("2027-05-11"), confirmedDate: null },
      { domain: "DATA", dueDate: new Date("2027-05-20"), confirmedDate: null },
    ],
    today,
  );
  assert.deepEqual(rows, [
    { domain: "IDENTITY", total: 2, done: 1, overdue: 1 },
    { domain: "DATA", total: 1, done: 0, overdue: 0 },
  ]);
});

test("AC-1.3 the sweep revokes at the instant, from either cut-off source", () => {
  const src = readFileSync("lib/jml/leave/departure.ts", "utf8");
  assert.match(src, /\{ accessCutoffAt: \{ lte: now \} \}/);
  assert.match(src, /\{ accessCutoffAt: null, lastPhysicalWorkingDay: \{ lte: today \} \}/);
  assert.match(src, /effectiveCutoff\(d, timeZone\)/);
  const step = readFileSync("lib/jml/leave/sweep-steps.ts", "utf8");
  assert.match(
    step,
    /departureMilestones\(\s*zonedToday\(now, calendar\.schedule\.timeZone\),\s*now,/,
  );
});

test("AC-1.4 only a leaver manager in scope sets it, never after revocation", () => {
  const src = readFileSync("lib/jml/register/access-items.ts", "utf8");
  assert.match(src, /loadCaseFor\(actor, caseId, "jml\.manageLeavers", "LEAVE"\)/);
  assert.match(src, /The login has already been revoked/);
  const route = readFileSync("app/api/jml/cases/[id]/access-cutoff/route.ts", "utf8");
  assert.match(route, /withRateLimit\(\s*withAuth\(/);
});
