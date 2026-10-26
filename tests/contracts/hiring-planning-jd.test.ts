import test from "node:test";
import assert from "node:assert/strict";
import {
  canRaiseRequisition,
  chaseableNeedIds,
  lastContact,
  stampsFor,
  summarizeRound,
} from "../../lib/hiring/planning-rules";
import {
  canRequestJdChanges,
  canSignJd,
  canSubmitJd,
  signableSlots,
  type JdContext,
} from "../../lib/hiring/jd-rules";

/** Hiring slice 2 — workforce planning (W01) and JD sign-off (step 3) invariants. */

test("round summary: responded counts zero as an answer; agreed falls back to requested", () => {
  const s = summarizeRound([
    {
      department: "Eng",
      status: "CHALLENGE_AGREED",
      rolesRequested: 3,
      agreedRoles: 2,
      raised: true,
    },
    {
      department: "Fin",
      status: "CHALLENGE_AGREED",
      rolesRequested: 1,
      agreedRoles: null,
      raised: false,
    },
    { department: "Ops", status: "SUBMITTED", rolesRequested: 4, agreedRoles: null, raised: false },
    { department: "HR", status: "NO_NEED", rolesRequested: 0, agreedRoles: 0, raised: false },
    { department: "Mkt", status: "ASKED", rolesRequested: null, agreedRoles: null, raised: false },
  ]);
  assert.equal(s.departmentsAsked, 5);
  assert.equal(s.responded, 4);
  assert.equal(s.outstanding, 1);
  assert.equal(s.rolesRequested, 8);
  assert.equal(s.agreedAfterChallenge, 3);
  assert.equal(s.stillToDiscuss, 4);
  assert.deepEqual(s.raisedDepartments, ["Eng"]);
  assert.deepEqual(s.readyToRaise, ["Fin"]);
});

test("raise gate: only a challenged need with ≥1 agreed role", () => {
  assert.deepEqual(
    canRaiseRequisition({ status: "CHALLENGE_AGREED", agreedRoles: 1, rolesRequested: 2 }),
    { ok: true },
  );
  assert.equal(
    canRaiseRequisition({ status: "CHALLENGE_AGREED", agreedRoles: 0, rolesRequested: 2 }).ok,
    false,
  );
  assert.equal(
    canRaiseRequisition({ status: "CHALLENGE_AGREED", agreedRoles: null, rolesRequested: 1 }).ok,
    true,
  );
  for (const status of ["NO_NEED", "SUBMITTED", "ASKED", "NO_RESPONSE"] as const) {
    assert.equal(
      canRaiseRequisition({ status, agreedRoles: 5, rolesRequested: 5 }).ok,
      false,
      status,
    );
  }
});

test("chase targets: asked and silent only", () => {
  assert.deepEqual(
    chaseableNeedIds([
      { id: "a", status: "ASKED", rolesRequested: null },
      { id: "b", status: "NO_RESPONSE", rolesRequested: null },
      { id: "c", status: "SUBMITTED", rolesRequested: 2 },
      { id: "d", status: "ASKED", rolesRequested: 0 },
    ]),
    ["a", "b"],
  );
});

test("last contact: the moment the status implies, degrading to what was recorded", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const base = { askedAt: at, chasedAt: null, submittedAt: null, discussedAt: null };
  assert.equal(lastContact({ ...base, status: "ASKED" }).kind, "asked");
  assert.equal(lastContact({ ...base, status: "NO_RESPONSE" }).kind, "noResponse");
  assert.equal(lastContact({ ...base, status: "NO_RESPONSE", chasedAt: at }).kind, "chased");
  assert.equal(lastContact({ ...base, status: "SUBMITTED", submittedAt: at }).kind, "submitted");
  assert.equal(
    lastContact({ ...base, status: "CHALLENGE_AGREED", discussedAt: at }).kind,
    "discussed",
  );
  assert.equal(
    lastContact({ ...base, status: "CHALLENGE_AGREED", submittedAt: at }).kind,
    "submitted",
  );
  assert.equal(lastContact({ ...base, status: "ASKED", chasedAt: at }).kind, "chased");
  assert.equal(lastContact({ ...base, status: "ASKED", askedAt: null }).at, null);
  const now = new Date();
  assert.deepEqual(stampsFor("SUBMITTED", now), { submittedAt: now });
  assert.deepEqual(stampsFor("NO_NEED", now), { discussedAt: now });
  assert.deepEqual(stampsFor("NO_RESPONSE", now), { chasedAt: now });
  assert.deepEqual(stampsFor("ASKED", now), {});
});

const ctx = (over: Partial<JdContext> = {}): JdContext => ({
  jdStatus: "AWAITING_SIGNOFF",
  description: "text",
  jdAuthorId: "drafter",
  hiringManagerId: "hm",
  signatures: [],
  ...over,
});
const hr = { id: "hr", canManage: true, hrEligible: true };
const hm = { id: "hm", canManage: true, hrEligible: false };

test("JD slots: HM slot is the hiring manager; HR slot never the HM or the drafter", () => {
  assert.equal(canSignJd(hm, "HIRING_MANAGER", ctx()).ok, true);
  assert.equal(canSignJd(hr, "HIRING_MANAGER", ctx()).ok, false);
  assert.equal(canSignJd(hr, "HR", ctx()).ok, true);
  assert.equal(
    canSignJd({ ...hm, hrEligible: true }, "HR", ctx()).ok,
    false,
    "HM cannot also be HR",
  );
  assert.equal(canSignJd({ ...hr, id: "drafter" }, "HR", ctx()).ok, false, "drafter");
  assert.equal(
    canSignJd(hr, "HR", ctx({ jdAuthorId: null })).ok,
    false,
    "unknown drafter fails closed",
  );
  assert.equal(canSignJd({ id: "x", canManage: true, hrEligible: false }, "HR", ctx()).ok, false);
  assert.equal(
    canSignJd({ id: "v", canManage: false, hrEligible: false }, "HR", ctx()).ok,
    false,
    "no standing",
  );
});

test("JD: one person cannot fill both slots; a filled slot is closed; state gates", () => {
  const both = { id: "hm", canManage: true, hrEligible: true };
  const signedHr = ctx({ signatures: [{ signatory: "HR", actorId: "hr" }] });
  assert.equal(canSignJd(hr, "HR", signedHr).ok, false);
  assert.equal(canSignJd(hm, "HIRING_MANAGER", signedHr).ok, true);
  assert.equal(
    canSignJd(
      both,
      "HR",
      ctx({
        hiringManagerId: "other",
        signatures: [{ signatory: "HIRING_MANAGER", actorId: "hm" }],
      }),
    ).ok,
    false,
  );
  assert.equal(canSignJd(hm, "HIRING_MANAGER", ctx({ jdStatus: "DRAFT" })).ok, false);
  assert.equal(canSignJd(hm, "HIRING_MANAGER", ctx({ jdStatus: "APPROVED" })).ok, false);
  assert.deepEqual(signableSlots(hr, ctx()), ["HR"]);
});

test("JD submit and send-back rules", () => {
  assert.equal(canSubmitJd(hr, ctx({ jdStatus: "DRAFT" })).ok, true);
  assert.equal(canSubmitJd(hr, ctx({ jdStatus: "CHANGES_REQUESTED" })).ok, true);
  assert.equal(canSubmitJd(hr, ctx({ jdStatus: "AWAITING_SIGNOFF" })).ok, false);
  assert.equal(canSubmitJd(hr, ctx({ jdStatus: "APPROVED" })).ok, false);
  assert.equal(canSubmitJd(hr, ctx({ jdStatus: "DRAFT", description: " " })).ok, false);
  assert.equal(
    canSubmitJd({ id: "v", canManage: false, hrEligible: false }, ctx({ jdStatus: "DRAFT" })).ok,
    false,
  );
  assert.equal(canRequestJdChanges(hm, ctx()).ok, true);
  assert.equal(
    canRequestJdChanges({ ...hr, id: "drafter" }, ctx()).ok,
    true,
    "a drafter may still send back",
  );
  assert.equal(
    canRequestJdChanges({ id: "x", canManage: true, hrEligible: false }, ctx()).ok,
    false,
  );
  assert.equal(canRequestJdChanges(hm, ctx({ jdStatus: "DRAFT" })).ok, false);
  assert.equal(
    canRequestJdChanges({ id: "v", canManage: false, hrEligible: false }, ctx()).ok,
    false,
  );
});
