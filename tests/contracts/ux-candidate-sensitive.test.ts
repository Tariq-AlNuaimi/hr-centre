import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expandGrants } from "../../lib/rbac/grants";
import { can, isPanelOnly, seesComp, seesPii } from "../../lib/hiring/access";
import { HIRING_STARTER_ROLES } from "../../lib/hiring/roles";

/**
 * UX review P0-2 (docs/blueprints/ux-p0.md, US-4): an interview panel never
 * receives a candidate's protected attributes (nationality, national ID,
 * gender, ethnicity) or pay expectation — from any page or API.
 */

const SUBJECT = { entityId: "rihal", departmentId: null, directorateId: null };
const panelist = {
  userId: "p1",
  name: "Panelist",
  grants: expandGrants([
    {
      permissions: HIRING_STARTER_ROLES.find((r) => r.key === "HIRING_PANELIST")!.permissions,
      scope: { type: "GROUP", id: null },
    },
  ]),
};

test("the Panelist starter role holds none of the sensitive-data permissions", () => {
  assert.equal(isPanelOnly(panelist, SUBJECT), true);
  assert.equal(seesPii(panelist, SUBJECT), false);
  assert.equal(can(panelist, "hiring.viewDei", SUBJECT), false);
  assert.equal(seesComp(panelist, SUBJECT), false);
});

const views = readFileSync("lib/hiring/candidate-views.ts", "utf8");

test("the profile projection gates each sensitive field on its own permission", () => {
  const contact = /contact: pii\s*\?\s*\{([\s\S]*?)\}\s*:\s*null/.exec(views)?.[1] ?? "";
  assert.match(contact, /nationality: c\.nationality/, "nationality only inside the PII block");
  assert.match(contact, /nec: openNec\(/, "national ID only inside the PII block");
  assert.match(views, /dei: dei \? \{ gender: c\.deiGender, ethnicity: c\.deiEthnicity \} : null/);
  assert.match(views, /salaryExpectation: comp\s*\?/);
  // Nothing sensitive outside those three gates.
  const outside = views.replace(contact, "");
  assert.doesNotMatch(outside, /nationality: c\.nationality|openNec\(/);
});

test("the candidate list carries no nationality at all", () => {
  const list = readFileSync("lib/hiring/candidates.ts", "utf8");
  assert.match(list, /map\(\(\{ nationality: _omit, \.\.\.row \}\) => row\)/);
});

test("panel-facing reads never select a sensitive column", () => {
  for (const file of [
    "lib/hiring/panel.ts",
    "app/api/hiring/panel/[id]/brief/route.ts",
    "lib/hiring/interview-views.ts",
    "lib/hiring/comparison.ts",
    "lib/hiring/evaluations.ts",
  ]) {
    const src = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    assert.doesNotMatch(
      src,
      /\b(nationality|necEnc|deiGender|deiEthnicity|salaryExpectationEnc)\s*:/,
      `${file} must not read a sensitive column`,
    );
  }
});

test("the UI keeps sensitive fields out of the list and in the profile's Sensitive section", () => {
  const listUi = readFileSync("components/hiring/candidates/CandidateList.tsx", "utf8");
  assert.doesNotMatch(listUi, /nationality/);
  const tab = readFileSync("components/hiring/candidates/ProfileTab.tsx", "utf8");
  const details = tab.slice(0, tab.indexOf("function SensitiveCard"));
  assert.doesNotMatch(details, /t\("(nationality|nec|gender|ethnicity|expectation)"\)/);
  assert.match(tab, /function SensitiveCard/);
});
