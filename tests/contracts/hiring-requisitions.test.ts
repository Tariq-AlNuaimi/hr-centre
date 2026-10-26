import test from "node:test";
import assert from "node:assert/strict";
import {
  composeDecisionNote,
  isAllowedTransition,
  isFinalStep,
  nextUnsignedStep,
  parseDecisionNote,
  readinessProblems,
  signRefusal,
} from "../../lib/hiring/requisition-rules";
import {
  buildBudgetCheck,
  describeFill,
  fillLabel,
  nextFillStatus,
  normalizeOpenings,
  occupiesSeat,
} from "../../lib/hiring/fill-rules";
import {
  buildChannelRows,
  canPost,
  daysBetween,
  isAdvertisable,
  notAdvertisedReason,
  omaniPreferredForced,
} from "../../lib/hiring/posting-rules";
import { formatBand, formatMoney, toNum, toOMR, toOMRorNull } from "../../lib/hiring/money";

/**
 * Hiring slice 2 — requisitions (docs/blueprints/hiring.md AC2.2–AC2.6):
 * Interview Hub's position-transitions, position-approval, requisition-fill,
 * requisition-budget, position-posting and currency invariants.
 */

test("status machine: publishing is gated; ARCHIVED terminal; CLOSED never a target", () => {
  assert.equal(isAllowedTransition("DRAFT", "OPEN"), false);
  assert.equal(isAllowedTransition("DRAFT", "PENDING_APPROVAL"), true);
  assert.equal(isAllowedTransition("PENDING_APPROVAL", "OPEN"), true);
  assert.equal(isAllowedTransition("PENDING_APPROVAL", "DRAFT"), true);
  assert.equal(isAllowedTransition("FILLED", "OPEN"), false);
  assert.equal(isAllowedTransition("FILLED", "REOPENED"), true);
  assert.equal(isAllowedTransition("ARCHIVED", "DRAFT"), false);
  assert.equal(isAllowedTransition("OPEN", "OPEN"), false);
  assert.equal(isAllowedTransition("OPEN", "CLOSED"), false);
});

test("readiness: all ten fields, positive whole openings, ordered band, real date", () => {
  assert.deepEqual(readinessProblems({}).length, 10);
  const ok = {
    title: "x",
    entityId: "e",
    departmentId: "d",
    hiringManagerId: "u",
    openings: 2,
    targetCloseDate: "2030-01-01",
    salaryBandMin: 1,
    salaryBandMax: 2,
    businessNeed: "n",
    alternativesConsidered: "a",
  };
  assert.deepEqual(readinessProblems(ok), []);
  assert.deepEqual(readinessProblems({ ...ok, openings: 0 }), ["openings"]);
  assert.deepEqual(readinessProblems({ ...ok, openings: 1.5 }), ["openings"]);
  assert.deepEqual(readinessProblems({ ...ok, salaryBandMin: 3 }), ["salaryBandMin"]);
  assert.deepEqual(readinessProblems({ ...ok, targetCloseDate: "nope" }), ["targetCloseDate"]);
  assert.deepEqual(readinessProblems({ ...ok, businessNeed: "   " }), ["businessNeed"]);
});

test("decision notes round-trip; unprefixed text is not given a verb", () => {
  for (const d of ["APPROVE", "REJECT", "SEND_BACK"] as const) {
    assert.deepEqual(parseDecisionNote(composeDecisionNote(d, "  why  ")), {
      decision: d,
      note: "why",
    });
  }
  assert.deepEqual(parseDecisionNote("Moved to hold"), { decision: null, note: "Moved to hold" });
});

test("two-step sign-off: next step by sequence AND role; final step detection", () => {
  const chain = [
    { sequence: 1, role: "HR_MANAGER" },
    { sequence: 2, role: "OPERATIONS_DIRECTOR" },
  ];
  assert.equal(nextUnsignedStep(chain, [])?.sequence, 1);
  assert.equal(nextUnsignedStep(chain, [{ sequence: 1, requiredRole: "HR_MANAGER" }])?.sequence, 2);
  assert.equal(
    nextUnsignedStep(chain, [{ sequence: 1, requiredRole: "COO" }])?.sequence,
    1,
    "a different role never counts",
  );
  assert.equal(
    nextUnsignedStep(chain, [
      { sequence: 1, requiredRole: "HR_MANAGER" },
      { sequence: 2, requiredRole: "OPERATIONS_DIRECTOR" },
    ]),
    undefined,
  );
  assert.equal(isFinalStep(chain, chain[1]), true);
  assert.equal(isFinalStep(chain, chain[0]), false);
  assert.equal(isFinalStep([], { sequence: 1 }), false);
});

test("separation of duties on a requisition step", () => {
  const base = {
    actorId: "a",
    isAdmin: false,
    requesterId: "r",
    routedApproverIds: ["a"],
    priorSignerIds: [],
  };
  assert.equal(signRefusal(base), null);
  assert.match(signRefusal({ ...base, requesterId: null })!, /re-submit/);
  assert.match(signRefusal({ ...base, actorId: "r", routedApproverIds: ["r"] })!, /submitted/);
  assert.match(signRefusal({ ...base, priorSignerIds: ["a"] })!, /earlier step/);
  assert.match(
    signRefusal({ ...base, priorSignerIds: ["a"], isAdmin: true })!,
    /earlier step/,
    "not admin-overridable",
  );
  assert.match(signRefusal({ ...base, routedApproverIds: [] })!, /routed/);
  assert.equal(signRefusal({ ...base, routedApproverIds: [], isAdmin: true }), null);
});

test("seat fill: accepted seats close the requisition; a released seat reopens it", () => {
  assert.equal(occupiesSeat("OFFER_ACCEPTED"), true);
  assert.equal(occupiesSeat("OFFER_EXTENDED"), false);
  assert.equal(occupiesSeat(null), false);
  assert.equal(normalizeOpenings(0), 1);
  assert.equal(normalizeOpenings("3"), 1);
  assert.equal(normalizeOpenings(3.7), 3);
  assert.equal(fillLabel(describeFill(1, 0)), "1 opening");
  assert.equal(fillLabel(describeFill(1, 1)), "Opening filled");
  assert.equal(fillLabel(describeFill(3, 1)), "1 of 3 openings filled");
  assert.equal(fillLabel(describeFill(2, 5)), "2 of 2 openings filled");
  assert.equal(describeFill(2, -1).filled, 0);
  assert.equal(nextFillStatus({ status: "OPEN", openings: 2, filled: 2 }), "FILLED");
  assert.equal(nextFillStatus({ status: "REOPENED", openings: 1, filled: 1 }), "FILLED");
  assert.equal(nextFillStatus({ status: "ON_HOLD", openings: 1, filled: 1 }), null);
  assert.equal(
    nextFillStatus({ status: "FILLED", openings: 2, filled: 1 }),
    null,
    "direction-blind would reopen",
  );
  assert.equal(
    nextFillStatus({ status: "FILLED", openings: 2, filled: 1, seatReleased: true }),
    "REOPENED",
  );
  assert.equal(nextFillStatus({ status: "OPEN", openings: 2, filled: 1 }), null);
});

test("budget check: band max × 12 × openings against the envelope (display only)", () => {
  const env = { fiscalYear: "FY27", amountOMR: 50_000, setBy: "Finance", setOn: "2026-10-01" };
  const b = buildBudgetCheck({ bandMaxOMR: 2000, openings: 2, envelope: env });
  assert.equal(b.annualisedOMR, 48_000);
  assert.equal(b.remainingOMR, 2000);
  assert.equal(b.overEnvelope, false);
  assert.equal(
    buildBudgetCheck({ bandMaxOMR: 2500, openings: 2, envelope: env }).overEnvelope,
    true,
  );
  assert.equal(
    buildBudgetCheck({ bandMaxOMR: null, openings: 1, envelope: env }).remainingOMR,
    null,
  );
  assert.equal(
    buildBudgetCheck({ bandMaxOMR: 1000, openings: 1, envelope: null }).remainingOMR,
    null,
  );
});

test("posting: only OPEN + JD-signed; distinct refusals; Tawteen is Omani-preferred", () => {
  assert.deepEqual(canPost("OPEN", new Date()), { ok: true });
  assert.equal(canPost("OPEN", null).ok, false);
  for (const s of ["DRAFT", "PENDING_APPROVAL", "ON_HOLD", "REOPENED", "FILLED"]) {
    const g = canPost(s, new Date());
    assert.equal(g.ok, false, s);
  }
  assert.match((canPost("FILLED", null) as { reason: string }).reason, /filled requisition/);
  assert.equal(omaniPreferredForced("TAWTEEN"), true);
  assert.equal(omaniPreferredForced("LINKEDIN"), false);
});

test("advertisable = OPEN ∧ JD signed ∧ live careers posting; reason names the first gap", () => {
  const r = { status: "OPEN", jdApprovedAt: new Date(), hasLiveCareersPosting: true };
  assert.equal(isAdvertisable(r), true);
  assert.equal(notAdvertisedReason(r), null);
  assert.equal(notAdvertisedReason({ ...r, status: "ON_HOLD" }), "notOpen");
  assert.equal(notAdvertisedReason({ ...r, jdApprovedAt: null }), "jdUnsigned");
  assert.equal(notAdvertisedReason({ ...r, hasLiveCareersPosting: false }), "notPosted");
});

test("channel rows: one per channel, applicants by source, unposted rows are honest", () => {
  const rows = buildChannelRows(
    [
      {
        channel: "LINKEDIN",
        live: true,
        detail: null,
        omaniPreferred: false,
        postedAt: "2026-10-01T00:00:00Z",
        postedByName: "A",
        withdrawnAt: null,
      },
    ],
    { LINKEDIN_PASTE: 3, CAREERS_PAGE: 2, REFERRAL: 1 },
  );
  assert.equal(rows.length, 6);
  assert.equal(rows.find((r) => r.channel === "LINKEDIN")!.applicants, 3);
  assert.equal(rows.find((r) => r.channel === "CAREERS_PAGE")!.live, false);
  assert.equal(rows.find((r) => r.channel === "CAREERS_PAGE")!.applicants, 2);
  assert.equal(daysBetween("2026-10-01", "2026-10-11"), 10);
  assert.equal(daysBetween("2026-10-11", "2026-10-01"), 0);
  assert.equal(daysBetween("x", "2026-10-01"), 0);
});

test("money: OMR base, null-preserving conversion, honest formatting", () => {
  assert.equal(toOMR(100, "USD"), 38.5);
  assert.equal(toOMR(100, "XYZ"), 100);
  assert.equal(toOMRorNull(null, "USD"), null);
  assert.equal(toOMRorNull("200", "OMR"), 200);
  assert.equal(toNum("abc"), null);
  assert.equal(toNum(Number.NaN), null);
  assert.equal(toNum({ toNumber: () => 1.5 }), 1.5);
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(1500), "1,500 OMR");
  assert.match(formatMoney(1000, "USD"), /≈ 385 OMR/);
  assert.equal(formatBand(null, null), "—");
  assert.equal(formatBand(1000, 1500), "1,000–1,500 OMR");
  assert.match(formatBand(1000, null, "USD"), /≈ 385–— OMR/);
});
