import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NAV, personaOf, type NavContext } from "../../lib/nav/config";
import { visibleNav } from "../../lib/nav/resolve";
import { myRequestState } from "../../lib/people/me";

/** P2 (UX R22) — the employee "Me" area and the persona flag (docs/blueprints/p2-me.md). */

const EMPLOYEE: Omit<NavContext, "persona"> = {
  isAdmin: false,
  employeeId: "e1",
  pms: {
    hr: false,
    lineManager: false,
    orgWide: false,
    runCalibration: false,
    previewImport: false,
    orgManage: false,
    loginsManage: false,
  },
  hive: { seeTickets: false, viewReports: false, editContent: false, configure: false },
  jml: () => false,
  jmlTaskWorker: false,
  hiring: () => false,
};

test("AC-2.1 an employee with no HR capability is the 'employee' persona", () => {
  assert.equal(personaOf(EMPLOYEE), "employee");
  assert.equal(personaOf({ ...EMPLOYEE, pms: { ...EMPLOYEE.pms, lineManager: true } }), "staff");
  assert.equal(personaOf({ ...EMPLOYEE, hiring: (p) => p === "hiring.view" }), "staff");
  assert.equal(personaOf({ ...EMPLOYEE, isAdmin: true }), "staff");
});

test("AC-1.1 the employee sees Home, Me (profile, performance, My HR) and People only", () => {
  const keys = visibleNav({ ...EMPLOYEE, persona: "employee" }).map((e) => `${e.group}:${e.key}`);
  assert.deepEqual(keys, [
    "home:home",
    "me:me-profile",
    "me:me-performance",
    "me:me-hr",
    "people:people",
    "people:org",
  ]);
});

test("AC-2.2 every HR tool entry is staff-only, even if its own gate were to open", () => {
  for (const e of NAV) {
    if (["talent", "service", "insights", "admin", "team"].includes(e.group) || e.key === "jml") {
      assert.deepEqual(e.personas, ["staff"], e.key);
    }
  }
  // A mistakenly-open gate still does not reach the employee.
  const leaky = visibleNav({
    ...EMPLOYEE,
    persona: "employee",
    hive: { ...EMPLOYEE.hive, seeTickets: true },
  }).map((e) => e.key);
  assert.ok(!leaky.includes("tickets"));
});

test("AC-1.2 my requests use employee words and never read drafts or HR names", () => {
  assert.equal(myRequestState("OPEN"), "WITH_HR");
  assert.equal(myRequestState("PENDING_APPROVAL"), "WITH_HR");
  assert.equal(myRequestState("SEND_FAILED"), "WITH_HR");
  assert.equal(myRequestState("SENT"), "ANSWERED");
  assert.equal(myRequestState("CLOSED"), "CLOSED");
  const src = readFileSync("lib/people/me.ts", "utf8");
  assert.doesNotMatch(src, /draftAnswer|draftedBy|approvedBy|assignee|EscalationEvent/);
  assert.match(src, /\{ employeeId \}/);
});

test("AC-1.3 my documents never read an ID number", () => {
  const src = readFileSync("lib/people/me.ts", "utf8");
  assert.doesNotMatch(src, /NumberEnc|civilIdNumber|passportNumber/);
  assert.match(src, /uploadedByEmployeeId: employeeId/);
});

test("AC-1.4 the Me pages read only the caller's own record", () => {
  for (const f of [
    "app/[locale]/(dashboard)/me/requests/page.tsx",
    "app/[locale]/(dashboard)/me/documents/page.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /actor\.employeeId/, f);
    assert.doesNotMatch(src, /searchParams/, f);
  }
});

test("AC-1.1 My HR opens on My requests, with My documents as its second tab", () => {
  const hr = visibleNav({ ...EMPLOYEE, persona: "employee" }).find((e) => e.key === "me-hr");
  assert.equal(hr?.href, "/me/requests");
  assert.deepEqual(
    hr?.tabs.map((t) => t.key),
    ["me-requests", "me-documents"],
  );
});
