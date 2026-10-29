import test from "node:test";
import assert from "node:assert/strict";
import {
  currentStep,
  decisionOutcome,
  decisionRefusal,
  delegationLive,
  vacantSteps,
  type DecisionState,
  type StepState,
} from "../../lib/core/approvals/rules";
import { offerDecisionRefusal } from "../../lib/hiring/offer-rules";
import { delegationSchema } from "../../lib/validations/core/approvals";

// ADR-094: the core approvals engine's rules. Every module's approvals ride on
// these, so each refusal is pinned, and Hiring's sentences are pinned against
// the engine codes (the parity the migration promised).

const step = (sequence: number, status: StepState["status"] = "WAITING", required = 1) => ({
  sequence,
  roleKey: `R${sequence}`,
  requiredApprovals: required,
  status,
});
const approved = (sequence: number, deciderId: string, onBehalfOfId: string | null = null) =>
  ({ sequence, deciderId, onBehalfOfId, action: "APPROVED" }) as DecisionState;
const base = {
  actorId: "a",
  actingFor: null,
  submitterId: "s",
  excludedIds: [] as string[],
  step: { sequence: 2 },
  decisions: [] as DecisionState[],
  qualified: true,
};

test("the current step is the first not yet approved", () => {
  assert.equal(currentStep([step(2), step(1, "APPROVED"), step(3)])?.sequence, 2);
  assert.equal(currentStep([step(1, "APPROVED")]), undefined);
});

test("refusals: no submitter, self-approval, a conflict, one person one step, not qualified", () => {
  assert.equal(decisionRefusal(base), null);
  assert.equal(decisionRefusal({ ...base, submitterId: null }), "NO_SUBMITTER");
  assert.equal(decisionRefusal({ ...base, submitterId: "a" }), "SUBMITTER");
  assert.equal(decisionRefusal({ ...base, excludedIds: ["a"] }), "EXCLUDED");
  assert.equal(decisionRefusal({ ...base, decisions: [approved(1, "a")] }), "PRIOR_STEP");
  assert.equal(decisionRefusal({ ...base, qualified: false }), "NOT_QUALIFIED");
});

test("a delegate is held to the same bans as the holder they act for", () => {
  // Acting for the submitter is still self-approval.
  assert.equal(decisionRefusal({ ...base, actingFor: "s" }), "SUBMITTER");
  // Acting for the referrer is still a conflict.
  assert.equal(decisionRefusal({ ...base, actingFor: "r", excludedIds: ["r"] }), "EXCLUDED");
  // The holder approved step 1 themselves; their delegate cannot take step 2 for them.
  assert.equal(
    decisionRefusal({ ...base, actingFor: "h", decisions: [approved(1, "h")] }),
    "PRIOR_STEP",
  );
  // The delegate approved step 1 for the holder; the holder cannot take step 2.
  assert.equal(
    decisionRefusal({ ...base, actorId: "h", decisions: [approved(1, "d", "h")] }),
    "PRIOR_STEP",
  );
});

test("two-holder steps need two DIFFERENT people", () => {
  const two = step(1, "CURRENT", 2);
  assert.equal(
    decisionOutcome({ steps: [two], step: two, action: "APPROVED", approvalsOnStepBefore: 0 }),
    "STEP_RECORDED",
  );
  assert.equal(
    decisionOutcome({ steps: [two], step: two, action: "APPROVED", approvalsOnStepBefore: 1 }),
    "APPROVED",
  );
  assert.equal(
    decisionRefusal({ ...base, step: { sequence: 1 }, decisions: [approved(1, "a")] }),
    "ALREADY",
  );
});

test("outcomes: a middle step passes, the last approves, a no closes at once", () => {
  const steps = [step(1, "CURRENT"), step(2)];
  const o = (s: StepState, action: DecisionState["action"]) =>
    decisionOutcome({ steps, step: s, action, approvalsOnStepBefore: 0 });
  assert.equal(o(steps[0], "APPROVED"), "STEP_APPROVED");
  assert.equal(o(steps[1], "APPROVED"), "APPROVED");
  assert.equal(o(steps[0], "REJECTED"), "REJECTED");
  assert.equal(o(steps[0], "SENT_BACK"), "SENT_BACK");
});

test("empty-holder refusal: a step nobody else can decide is vacant", () => {
  const steps = [
    { holderIds: ["s"], requiredApprovals: 1 },
    { holderIds: ["x", "y"], requiredApprovals: 2 },
    { holderIds: ["x"], requiredApprovals: 2 },
  ];
  assert.deepEqual(vacantSteps(steps, ["s"]), [steps[0], steps[2]]);
});

test("a delegation is live only inside its window and until revoked", () => {
  const d = {
    validFrom: new Date("2026-11-01"),
    validUntil: new Date("2026-11-10"),
    revokedAt: null,
  };
  assert.equal(delegationLive(d, new Date("2026-11-05")), true);
  assert.equal(delegationLive(d, new Date("2026-11-10")), false);
  assert.equal(delegationLive({ ...d, revokedAt: new Date() }, new Date("2026-11-05")), false);
});

test("delegations end after they start and last at most 90 days", () => {
  const ok = {
    delegateId: "u",
    module: "hiring",
    validFrom: "2026-11-01",
    validUntil: "2026-11-10",
  };
  assert.equal(delegationSchema.safeParse(ok).success, true);
  assert.equal(delegationSchema.safeParse({ ...ok, validUntil: "2026-10-01" }).success, false);
  assert.equal(delegationSchema.safeParse({ ...ok, validUntil: "2027-03-01" }).success, false);
  assert.equal(delegationSchema.safeParse({ ...ok, module: "payroll" }).success, false);
});

test("parity: Hiring's offer sentences sit on the engine's codes, in the order users saw", () => {
  const offer = {
    actorId: "a",
    submitterId: "s",
    referrerId: "r",
    qualified: true,
    priorApproverIds: [] as string[],
  };
  assert.equal(offerDecisionRefusal(offer), null);
  assert.match(offerDecisionRefusal({ ...offer, submitterId: null })!, /Can't tell who submitted/);
  assert.match(offerDecisionRefusal({ ...offer, submitterId: "a" })!, /segregation of duties/);
  assert.match(offerDecisionRefusal({ ...offer, referrerId: "a" })!, /referred this candidate/);
  assert.match(offerDecisionRefusal({ ...offer, priorApproverIds: ["a"] })!, /earlier step/);
  assert.match(offerDecisionRefusal({ ...offer, qualified: false })!, /holds this step's/);
  // Order: the submitter ban outranks "not qualified".
  assert.match(
    offerDecisionRefusal({ ...offer, submitterId: "a", qualified: false })!,
    /segregation of duties/,
  );
  // New with delegation: acting for the referrer is refused like being the referrer.
  assert.match(offerDecisionRefusal({ ...offer, actingForId: "r" })!, /referred this candidate/);
});
