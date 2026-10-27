import test from "node:test";
import assert from "node:assert/strict";

import { scheduleSchema, ruleUpdateSchema } from "../../lib/validations/jml/config";
import { scoringWeightsSchema, aiProviderSchema } from "../../lib/validations/hiring/ai";
import { publishSchema, setTargetSchema } from "../../lib/validations/calibration";
import { decideChangeRequestSchema } from "../../lib/validations/change-request";
import {
  candidateListQuerySchema,
  reviewDocumentSchema,
  stallCauseSchema,
} from "../../lib/validations/hiring/candidate";
import { assignmentBodySchema } from "../../lib/validations/rbac";
import { coverageSchema, rotationConfigSchema } from "../../lib/validations/hive/reference";
import { reviseOfferSchema, createOfferSchema } from "../../lib/validations/hiring/offer";

/**
 * The cross-field rules of the boundary schemas — each refusal is a sentence a
 * person reads, so each is pinned with an input that fails ONLY that rule.
 * (They had no direct test; lib/** function coverage fell below its floor.)
 */

const fails = (r: { success: boolean; error?: { issues: { message: string }[] } }, re: RegExp) => {
  assert.equal(r.success, false);
  assert.match(r.error!.issues.map((i) => i.message).join(" | "), re);
};

test("jml schedule: the working window must end after it starts", () => {
  const base = { workingDays: [1, 2, 3, 4, 7], startHour: 8, endHour: 17, timeZone: "Asia/Muscat" };
  assert.equal(scheduleSchema.safeParse(base).success, true);
  fails(scheduleSchema.safeParse({ ...base, endHour: 8 }), /end after it starts/);
  fails(scheduleSchema.safeParse({ ...base, timeZone: "Mars/Olympus" }), /IANA/);
});

test("jml HR rule edit: level and unit change together", () => {
  assert.equal(ruleUpdateSchema.safeParse({ priority: 3 }).success, true);
  fails(ruleUpdateSchema.safeParse({ scope: "COMPANY" }), /change together/);
});

test("hiring AI: weights total 100; a base URL is checked", () => {
  const w = { skills: 40, experience: 30, education: 10, culture: 10, language: 10 };
  assert.equal(scoringWeightsSchema.safeParse(w).success, true);
  fails(scoringWeightsSchema.safeParse({ ...w, skills: 41 }), /add up to 100/);
  const p = { provider: "openai", baseUrl: "", model: "m" };
  assert.equal(aiProviderSchema.safeParse(p).success, true);
  fails(
    aiProviderSchema.safeParse({ ...p, baseUrl: "http://169.254.169.254/" }),
    /Base URL rejected/,
  );
});

test("calibration: un-publishing carries a reason; band targets total 100", () => {
  const pub = { cycleId: "c", action: "UNPUBLISH", confirm: "CONFIRM" };
  fails(publishSchema.safeParse(pub), /carries a reason/);
  assert.equal(publishSchema.safeParse({ ...pub, reason: "Wrong data" }).success, true);
  const t = {
    cycleId: "c",
    outstandingPct: 10,
    excellentPct: 20,
    targetPct: 40,
    almostAchievedPct: 20,
    unsatisfactoryPct: 10,
  };
  assert.equal(setTargetSchema.safeParse(t).success, true);
  fails(setTargetSchema.safeParse({ ...t, targetPct: 30 }), /total exactly 100/);
});

test("change requests: a rejection needs a reason and overrides nothing", () => {
  fails(decideChangeRequestSchema.safeParse({ decision: "REJECT" }), /must carry a reason/);
  fails(
    decideChangeRequestSchema.safeParse({ decision: "REJECT", reason: "No", overrideReason: "x" }),
    /nothing to override/,
  );
  assert.equal(decideChangeRequestSchema.safeParse({ decision: "APPROVE" }).success, true);
});

test("candidates: list ranges are ordered; a stall note follows its cause; a review changes something", () => {
  fails(candidateListQuerySchema.safeParse({ scoreMin: 80, scoreMax: 20 }), /Minimum score/);
  fails(
    candidateListQuerySchema.safeParse({ interviewCountMin: 3, interviewCountMax: 1 }),
    /Minimum interviews/,
  );
  fails(
    candidateListQuerySchema.safeParse({ createdFrom: "2026-10-10", createdTo: "2026-10-01" }),
    /on or before/,
  );
  assert.equal(candidateListQuerySchema.safeParse({}).success, true);
  fails(stallCauseSchema.safeParse({ cause: "OTHER" }), /records nothing/);
  fails(stallCauseSchema.safeParse({ cause: null, note: "left" }), /clears the note/);
  fails(reviewDocumentSchema.safeParse({}), /Nothing to update/);
  assert.equal(reviewDocumentSchema.safeParse({ reviewed: true }).success, true);
});

test("role assignments: group and own pair take no unit; every other scope needs one", () => {
  const a = { userId: "u", roleId: "r", scopeType: "GROUP" };
  assert.equal(assignmentBodySchema.safeParse(a).success, true);
  fails(assignmentBodySchema.safeParse({ ...a, scopeType: "COMPANY" }), /need no unit/);
  fails(assignmentBodySchema.safeParse({ ...a, scopeId: "c1" }), /need no unit/);
});

test("ticket reference data: company-wide coverage names the company; the rotation anchor is a Sunday", () => {
  const c = { pairId: "p", label: "Rihal", aliases: [], companyWide: true, entityId: "" };
  fails(coverageSchema.safeParse(c), /company this row covers/);
  const r = rotationConfigSchema.safeParse({ anchorDate: "2026-10-27", anchorType: "A" });
  assert.equal(r.success, false);
  assert.match(JSON.stringify(r.error?.issues), /Sunday/);
});

test("offers: a revision changes a term; allowances are capped at 20", () => {
  fails(reviseOfferSchema.safeParse({ candidateNote: "hi" }), /at least one term/);
  assert.equal(reviseOfferSchema.safeParse({ salary: 900 }).success, true);
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`a${i}`, 1]));
  fails(
    createOfferSchema.safeParse({ candidateId: "c", startDate: "2026-12-01", allowances: many }),
    /At most 20 allowances/,
  );
});

test("change requests: weightages are 0–100 with two decimals; edits change something, once per KPI", async () => {
  const { createChangeRequestSchema } = await import("../../lib/validations/change-request");
  const req = (edits: unknown[]) =>
    createChangeRequestSchema.safeParse({ participantId: "p", rationale: "Rebalance", edits });
  assert.equal(
    req([
      { kpiId: "k1", weightage: 40 },
      { kpiId: "k2", weightage: "60.5" },
    ]).success,
    true,
  );
  fails(req([{ kpiId: "k1", weightage: "12.345" }]), /two decimal places/);
  fails(req([{ kpiId: "k1", weightage: 140 }]), /between 0 and 100/);
  fails(req([{ kpiId: "k1" }]), /change at least one field/);
  fails(
    req([
      { kpiId: "k1", weightage: 50 },
      { kpiId: "k1", weightage: 50 },
    ]),
    /at most once/,
  );
});

test("roles: a blank description is null; permissions are de-duplicated and catalogue-checked", async () => {
  const { roleBodySchema } = await import("../../lib/validations/rbac");
  const r = roleBodySchema.safeParse({
    name: "Viewer",
    description: "",
    permissions: ["people.view", "people.view"],
  });
  assert.equal(r.success, true);
  assert.equal(r.data!.description, null);
  assert.deepEqual(r.data!.permissions, ["people.view"]);
  fails(roleBodySchema.safeParse({ name: "X", permissions: ["made.up"] }), /catalogue/);
});

test("leaver activation refusals read as one sentence, however many there are", async () => {
  const { describeRefusal } = await import("../../lib/jml/leave/rules");
  assert.equal(describeRefusal([]), "This case cannot be activated yet.");
  assert.equal(describeRefusal([{ field: "a", message: " One. " }]), "One.");
  assert.match(
    describeRefusal([
      { field: "a", message: "One." },
      { field: "b", message: "Two." },
    ]),
    /2 things need attention\. One\. Two\./,
  );
});
