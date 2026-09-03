import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import {
  CYCLE_POLICY_SELECT,
  DEFAULT_CYCLE_POLICY,
  policyEditBlockedReason,
  policyFor,
} from "../../lib/pms/cycle-policy";
import { bandFor } from "../../lib/pms/scoring";
import { divergenceBlockedReason } from "../../lib/pms/rating";
import { cyclePolicySchema } from "../../lib/validations/cycle";

/**
 * §6.2 / §7.1 / §8.7 as HR-settable policy.
 *
 * The property that matters most here is the boring one: **adding this changed
 * nothing.** A policy mechanism that quietly re-decides an open question on the
 * day it ships is worse than no mechanism, so the first block asserts that every
 * default reproduces the behaviour the code had before these columns existed —
 * and that a caller who passes no policy at all gets that same behaviour rather
 * than a throw or a silent inversion.
 */

/* -- the defaults are the old behaviour ------------------------------------ */

test("the documented defaults are exactly what the code did before", () => {
  assert.deepEqual(DEFAULT_CYCLE_POLICY, {
    requireResignAfterChange: false,
    divergenceReason: "REQUIRED",
    roundScoreBeforeBanding: false,
  });
});

test("a cycle that predates the policy columns behaves as it always did", () => {
  // No backfill was written, deliberately: the defaults ARE the old behaviour,
  // so an old cycle re-bands identically rather than needing a data migration.
  assert.deepEqual(policyFor(null), DEFAULT_CYCLE_POLICY);
  assert.deepEqual(policyFor(undefined), DEFAULT_CYCLE_POLICY);
  assert.deepEqual(policyFor({}), DEFAULT_CYCLE_POLICY);
});

test("a partially-loaded cycle fills the gaps rather than throwing", () => {
  const p = policyFor({ roundScoreBeforeBanding: true });
  assert.equal(p.roundScoreBeforeBanding, true);
  assert.equal(p.divergenceReason, "REQUIRED");
  assert.equal(p.requireResignAfterChange, false);
});

/* -- §8.7, the boundary that decides real money ---------------------------- */

test("without rounding, 4.495 is Excellent — it is not yet 4.50", () => {
  assert.equal(bandFor("4.495"), "EXCELLENT");
  assert.equal(bandFor("4.495", { roundScoreBeforeBanding: false }), "EXCELLENT");
});

test("with rounding, the same number is Outstanding", () => {
  // §11.3 ties the band to a bonus coefficient, so this one flag is the
  // difference between 2.0x and 1.5x of basic salary at this boundary. That is
  // why it is Rihal's decision and not the build's.
  assert.equal(bandFor("4.495", { roundScoreBeforeBanding: true }), "OUTSTANDING");
});

test("rounding changes nothing away from a boundary", () => {
  for (const score of ["5.00", "4.60", "4.00", "3.50", "2.00", "1.20"]) {
    assert.equal(
      bandFor(score, { roundScoreBeforeBanding: true }),
      bandFor(score, { roundScoreBeforeBanding: false }),
      `score ${score} banded differently under the two readings`,
    );
  }
});

test("rounding is half-up, so 4.494 stays put and 4.495 moves", () => {
  assert.equal(bandFor("4.494", { roundScoreBeforeBanding: true }), "EXCELLENT");
  assert.equal(bandFor("4.495", { roundScoreBeforeBanding: true }), "OUTSTANDING");
});

test("every band boundary moves the same way, not just the top one", () => {
  const cases = [
    ["3.995", "TARGET", "EXCELLENT"],
    ["2.995", "ALMOST_ACHIEVED", "TARGET"],
    ["1.995", "UNSATISFACTORY", "ALMOST_ACHIEVED"],
  ] as const;
  for (const [score, exact, rounded] of cases) {
    assert.equal(bandFor(score), exact);
    assert.equal(bandFor(score, { roundScoreBeforeBanding: true }), rounded);
  }
});

test("bandFor called with no policy at all still bands", () => {
  // The signature stayed backwards-compatible on purpose: a call site missed
  // during the threading behaves exactly as before rather than failing.
  assert.equal(bandFor("4.50"), "OUTSTANDING");
});

/* -- §7.1 ------------------------------------------------------------------ */

const diverging = {
  party: "MANAGER" as const,
  level: 2,
  employeeLevel: 5,
  comment: null,
};

test("REQUIRED blocks a divergent rating with no reason", () => {
  const blocked = divergenceBlockedReason(diverging);
  assert.ok(blocked && blocked.includes("Say why"));
});

test("OPTIONAL and OFF both let it through", () => {
  for (const divergenceReason of ["OPTIONAL", "OFF"] as const) {
    assert.equal(divergenceBlockedReason({ ...diverging, policy: { divergenceReason } }), null);
  }
});

test("REQUIRED still passes when a reason was given", () => {
  assert.equal(
    divergenceBlockedReason({
      ...diverging,
      comment: "Missed the delivery date twice.",
      policy: { divergenceReason: "REQUIRED" },
    }),
    null,
  );
});

test("no policy passed means REQUIRED, the pre-existing rule", () => {
  assert.ok(divergenceBlockedReason(diverging) !== null);
});

test("the employee's own rating is never blocked, whatever the policy says", () => {
  // A self-assessment has nothing to diverge FROM, and requiring a person to
  // justify their own view of their own year is a different, worse rule.
  for (const divergenceReason of ["REQUIRED", "OPTIONAL", "OFF"] as const) {
    assert.equal(
      divergenceBlockedReason({
        party: "EMPLOYEE",
        level: 5,
        employeeLevel: null,
        comment: null,
        policy: { divergenceReason },
      }),
      null,
    );
  }
});

/* -- the freeze ------------------------------------------------------------ */

test("policy is editable only while the cycle is a draft", () => {
  assert.equal(policyEditBlockedReason("DRAFT"), null);
  for (const status of ["OPEN", "CLOSED"]) {
    const blocked = policyEditBlockedReason(status);
    assert.ok(blocked, `${status} should refuse a policy edit`);
    assert.ok(blocked.includes(status.toLowerCase()), "the refusal names the actual status");
  }
});

/* -- the boundary ---------------------------------------------------------- */

test("the policy schema refuses an unknown key rather than stripping it", () => {
  // zod's default is to strip. On a policy that decides a bonus coefficient,
  // a 200 that silently changed nothing is the worst available answer.
  assert.ok(!cyclePolicySchema.safeParse({ roundScoresBeforeBanding: true }).success);
});

test("the policy schema refuses an empty body", () => {
  assert.ok(!cyclePolicySchema.safeParse({}).success);
});

test("the policy schema accepts one field at a time", () => {
  assert.ok(cyclePolicySchema.safeParse({ roundScoreBeforeBanding: true }).success);
  assert.ok(cyclePolicySchema.safeParse({ divergenceReason: "OFF" }).success);
  assert.ok(cyclePolicySchema.safeParse({ requireResignAfterChange: true }).success);
});

test("the policy schema refuses a divergence value that is not one of the three", () => {
  assert.ok(!cyclePolicySchema.safeParse({ divergenceReason: "MANDATORY" }).success);
});

/* -- the wiring, guarded ---------------------------------------------------- */

test("CYCLE_POLICY_SELECT names exactly the policy fields, no more and no fewer", () => {
  // A column added to `CyclePolicy` but forgotten here would be selected by
  // nobody, so `policyFor` would silently return its default and the new
  // setting would do nothing at all — the quietest possible failure.
  assert.deepEqual(
    Object.keys(CYCLE_POLICY_SELECT).sort(),
    Object.keys(DEFAULT_CYCLE_POLICY).sort(),
  );
  assert.ok(Object.values(CYCLE_POLICY_SELECT).every((v) => v === true));
});

test("every route that ACTS on a policy also selects one", () => {
  // Source-level, and deliberately so. The failure this catches is not a type
  // error and not a runtime throw: a consumer that calls `policyFor(cycle)` on
  // a cycle whose columns were never selected gets the DEFAULTS back, forever,
  // and the HR setting reads as saved while changing nothing. TypeScript cannot
  // see it (the fields are optional on `Partial<CyclePolicy>`), and no unit test
  // of a pure function can either.
  const consumers = [
    "app/api/scores/route.ts", // §8.7 — bands with it
    "app/api/kpi-ratings/route.ts", // §7.1 — enforces the divergence reason
    "app/api/kpi-change-requests/[id]/decide/route.ts", // §6.2 — clears signatures
    "app/api/cycles/[id]/policy/route.ts", // reads and writes it
  ];
  for (const file of consumers) {
    const src = readFileSync(file, "utf8");
    assert.ok(
      src.includes("policyFor("),
      `${file} is listed as a policy consumer but never calls policyFor()`,
    );
    // USED in a select, not merely imported. Checking for the bare identifier
    // passes on the import line alone — verified by deleting the spread from
    // kpi-ratings and watching this test stay green, which is the kind of guard
    // that is worse than none. Both spellings count: spread into a wider select
    // (`...CYCLE_POLICY_SELECT`) or used as the whole select
    // (`select: CYCLE_POLICY_SELECT`), which is what the decide route does
    // because the cycle it loads carries nothing else.
    assert.ok(
      src.includes("...CYCLE_POLICY_SELECT") || src.includes("select: CYCLE_POLICY_SELECT"),
      `${file} calls policyFor() without putting CYCLE_POLICY_SELECT in a select — ` +
        "it would silently get the defaults and the HR setting would do nothing",
    );
  }
});
