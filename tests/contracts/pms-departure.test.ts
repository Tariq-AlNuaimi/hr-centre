import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { departureReportsWhere, departureThreeSixtyWhere } from "../../lib/pms/departure";

/**
 * §12.1 — a departure has four consequences, and the thing worth testing is
 * that there is exactly ONE writer of them.
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("§12.1 whose line moves: not leavers, not soft-deleted records", () => {
  // A leaver's own line already closed out, and a soft-deleted row is an
  // erroneous record rather than a person who reports to anyone.
  assert.deepEqual(departureReportsWhere("mgr-1"), {
    managerId: "mgr-1",
    deletedAt: null,
    status: { not: "LEAVER" },
  });
});

test("§12.1 a SUBMITTED 360 assignment is not reassignment work", () => {
  // §9.4's "exactly 3" is satisfied by the answers, not by the answerer still
  // being employed — so a submitted form is done, whoever has left since.
  assert.deepEqual(departureThreeSixtyWhere("emp-1"), {
    raterId: "emp-1",
    status: { not: "SUBMITTED" },
  });
});

test("the confirmation and the write are built from the SAME predicates", () => {
  // A confirmation that says "3 reports will move" beside a write that moves 4
  // is worse than no confirmation: it teaches the reader to stop reading it.
  // Both sides must come from lib/pms/departure.ts, not from a hand-written
  // query — the §6.2 defect this repo keeps producing.
  const leavers = stripComments(readFileSync("app/api/leavers/route.ts", "utf8"));
  assert.match(leavers, /departureReportsWhere\(/, "the write must use the shared predicate");
  assert.match(leavers, /departureThreeSixtyWhere\(/);
  assert.doesNotMatch(
    leavers,
    /managerId:\s*employeeId,\s*deletedAt:\s*null/,
    "no hand-written copy of the reports query",
  );
  assert.doesNotMatch(
    leavers,
    /raterId:\s*employeeId,\s*status:\s*\{\s*not:\s*"SUBMITTED"/,
    "no hand-written copy of the 360 query",
  );

  const page = stripComments(readFileSync("app/[locale]/(dashboard)/people/[id]/page.tsx", "utf8"));
  assert.match(page, /departurePreview\(/, "the page must preview from the same module");
});

test("the employee edit route REFUSES to off-board, and names the action", () => {
  // It used to accept the transition and revoke the login while doing none of
  // §12.1's roll-up — a revoked login beside a team still reporting to someone
  // who has gone. Unreachable only because the form did not render the field,
  // and adding that field (what HR asked for) would have armed it.
  const route = stripComments(readFileSync("app/api/employees/[id]/route.ts", "utf8"));
  const guard = route.slice(route.indexOf('data.status === "LEAVER"'));
  assert.match(guard.slice(0, 400), /return err\(/, "the LEAVER transition must be refused");
  assert.match(guard.slice(0, 600), /Record departure/, "and must name where to do it");

  // Reinstating is equally not a field edit: the reports were already moved.
  assert.match(route, /data\.status === "ACTIVE" && target\.status === "LEAVER"/);

  // And it must no longer be the thing that revokes a login.
  assert.doesNotMatch(route, /revokeLoginOnOffboard/);
});

test("the departure dialog posts to the ONE writer, not to the field edit", () => {
  const dialog = stripComments(readFileSync("components/pms/RecordDepartureDialog.tsx", "utf8"));
  assert.match(dialog, /apiClient\.post\("\/api\/leavers"/);
  assert.doesNotMatch(dialog, /\/api\/employees\//, "a departure is not a field edit");
  // §11.4 pro-rates from the cycle start to this date, so it cannot be blank.
  assert.match(dialog, /lastWorkingDayRequired/);
  // Already departed → no button at all; §12.1 preserves the record.
  assert.match(dialog, /preview\.alreadyLeaver/);
});

test("every consequence in the confirmation has a string, including the empty cases", () => {
  // The null-target case is the one §12.1 most needs a prompt for (the departing
  // manager was at the top), and an empty count must not render as "0 reports
  // move to " with a blank name.
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as {
    pms: { departure: Record<string, string> };
  };
  const d = en.pms.departure;
  for (const key of [
    "effectStatus",
    "effectReports",
    "effectReportsNoTarget",
    "effectNoReports",
    "effectThreeSixty",
    "effectNoThreeSixty",
    "effectLogin",
    "effectNoLogin",
    "effectRecordKept",
  ]) {
    assert.ok(d[key] && d[key].length > 0, `pms.departure.${key} must exist`);
  }
  assert.match(d.effectRecordKept, /deleted|preserved/i, "§12.1's promise must be stated");
  assert.match(d.lastWorkingDayHelp, /11\.4|pro-rated/i, "say why the date matters");
});

test("both locales carry the departure namespace", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as {
    pms: { departure: Record<string, string> };
  };
  const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")) as {
    pms: { departure: Record<string, string> };
  };
  assert.deepEqual(
    Object.keys(en.pms.departure).sort(),
    Object.keys(ar.pms.departure).sort(),
    "a missing Arabic key renders the key name to the user",
  );
});

test("a leaver's last working day stays correctable on the edit form", () => {
  const form = readFileSync("components/pms/EmployeeEditForm.tsx", "utf8");
  assert.match(
    form,
    /initial\.status === "LEAVER" \? \(\s*<FormField\s+name="lastWorkingDay"/,
    "the field must render for a leaver, so a mistyped departure date can be fixed",
  );
  assert.match(form, /t\("lastWorkingDayHelp"\)/);
});

test("the edit form no longer sends HR to the edge-case screen for a departure", () => {
  // The operator's own report was that they could not find this. The copy used
  // to name a different screen than the action now beside it.
  const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
  const copy = en.pms.editEmployee.notEditedHere;
  assert.doesNotMatch(copy, /edge-case/i);
  assert.match(copy, /Record departure/);
  assert.ok(en.pms.editEmployee.lastWorkingDayHelp, "the correction field needs its own help text");
});

test("the preview is not computed for a record that has already departed", () => {
  const page = stripComments(readFileSync("app/[locale]/(dashboard)/people/[id]/page.tsx", "utf8"));
  assert.match(page, /employee\.status === "LEAVER" \? null : await departurePreview/);
});
