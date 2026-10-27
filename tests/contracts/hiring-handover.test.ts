import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handoverRefusal,
  handoverRoute,
  preboardingChecklist,
} from "../../lib/hiring/preboarding-rules";
import { muscatMidnight, sourceRefFor, toContractType } from "../../lib/hiring/prejoiner";

const read = (f: string) => readFileSync(f, "utf8");
const clear = preboardingChecklist({
  signedOffer: true,
  packageConfirmed: false,
  packageDeclined: true,
  nationalId: true,
  joiningDate: new Date(),
});
const base = {
  stage: "OFFER_ACCEPTED",
  route: "TRANSFERRED" as const,
  recorded: false,
  actorIsOwnerOrAdmin: true,
  checklist: clear,
  recipientId: "u2",
  recipientEligible: true,
  ownerId: "u1",
  note: "Over to you",
};

test("route: no owner fails closed; an HR-manager owner transfers; anyone else keeps", () => {
  assert.equal(handoverRoute(null, false), "UNASSIGNED");
  assert.equal(handoverRoute("u1", true), "TRANSFERRED");
  assert.equal(handoverRoute("u1", false), "RETAINED");
});

test("D5: a declined package clears the package item", () => {
  assert.ok(clear.every((c) => c.cleared));
  const open = preboardingChecklist({
    signedOffer: true,
    packageConfirmed: false,
    packageDeclined: false,
    nationalId: true,
    joiningDate: null,
  });
  assert.deepEqual(
    open.filter((c) => !c.cleared).map((c) => c.key),
    ["package", "joiningDate"],
  );
});

test("handover refusals, in order", () => {
  assert.equal(handoverRefusal(base), null);
  assert.equal(handoverRefusal({ ...base, stage: "OFFER_EXTENDED" })?.code, "WRONG_STAGE");
  assert.equal(handoverRefusal({ ...base, route: "UNASSIGNED" })?.code, "NO_OWNER");
  assert.equal(handoverRefusal({ ...base, actorIsOwnerOrAdmin: false })?.code, "NOT_OWNER");
  assert.equal(handoverRefusal({ ...base, recorded: true })?.code, "ALREADY_RECORDED");
  assert.equal(
    handoverRefusal({ ...base, checklist: [{ key: "signedOffer", cleared: false }] })?.code,
    "CHECKLIST_OPEN",
  );
  assert.equal(handoverRefusal({ ...base, recipientEligible: false })?.code, "BAD_RECIPIENT");
  assert.equal(handoverRefusal({ ...base, recipientId: "u1" })?.code, "SAME_PERSON");
  assert.equal(handoverRefusal({ ...base, note: "  " })?.code, "NOTE_REQUIRED");
  assert.equal(handoverRefusal({ ...base, route: "RETAINED", recipientId: "u1", note: "" }), null);
});

test("hand-off helpers: idempotency key, contract mapping, Muscat calendar day", () => {
  assert.equal(sourceRefFor("abc"), "hiring:abc");
  assert.equal(toContractType("Fixed term"), "FIXED_TERM");
  assert.equal(toContractType("permanent"), "PERMANENT");
  assert.equal(toContractType("something else"), null);
  assert.equal(
    muscatMidnight(new Date("2026-11-01T21:30:00Z")).toISOString(),
    "2026-11-02T00:00:00.000Z",
  );
});

test("every path to OFFER_ACCEPTED hands off; leaving after acceptance withdraws", () => {
  const src = read("lib/hiring/candidate-stage.ts");
  assert.match(src, /toStage === "OFFER_ACCEPTED"\) handoff = await handToJml/);
  assert.match(src, /withdrawFromJml\(/);
  const pre = read("lib/hiring/prejoiner.ts");
  assert.match(pre, /employeeCreateData\(/);
  assert.match(pre, /status: "PRE_JOINER"/);
  assert.match(pre, /openJoinCase\(/);
  assert.match(pre, /where: \{ id: c.id, employeeId: null \}/);
  assert.doesNotMatch(pre, /tx\.employee\.update|prisma\.employee\.update/);
});

test("the record's Hiring tab is scope-checked and never carries pay", () => {
  const src = read("lib/hiring/employee-tab.ts");
  assert.match(src, /can\(actor, "hiring\.view"/);
  assert.doesNotMatch(src, /salary|Enc\b/i);
  assert.match(read("components/people/RecordTabs.tsx"), /"hiring"\] as const/);
});
