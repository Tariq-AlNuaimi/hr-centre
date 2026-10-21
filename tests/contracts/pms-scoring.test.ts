import test from "node:test";
import assert from "node:assert/strict";

import {
  BAND_COEFFICIENT,
  TRACK_WEIGHTS,
  bandFor,
  finalScore,
  individualScore,
  threeSixtyAsLevel,
} from "../../lib/pms/scoring";
import { scoreEmployee } from "../../lib/pms/score-run";
import { Prisma } from "../../generated/prisma/client";

/**
 * §8 — the scoring model, checked against the SPECIFICATION'S OWN worked
 * examples wherever it gives one. Where the spec computes a number, that number
 * is the assertion; nothing here is a value I chose to make the code pass.
 */

const kpi = (level: number, weightage: string) => ({ level, weightage });

// --- §8.2, using the spec's example arithmetic -----------------------------------

test("§8.2 Rating × Weightage — the spec's own two lines", () => {
  // "KPI A = Target(3) × 5% = 0.15; KPI B = Excellent(4) × 20% = 0.80"
  assert.equal(individualScore([kpi(3, "5"), kpi(4, "20"), kpi(3, "75")]).toString(), "3.2");
  //                                0.15    +      0.80     +   2.25   = 3.20
});

test("§8.2 a set rated all-Target scores exactly 3", () => {
  // §5.3 forces the weightages to 100, so an all-Target set must land on the
  // scale's midpoint — the clearest statement that the bucket is on 1–5.
  assert.equal(individualScore([kpi(3, "40"), kpi(3, "35"), kpi(3, "25")]).toString(), "3");
});

test("§8.2 all-Outstanding is 5 and all-Unsatisfactory is 1 — the scale's ends", () => {
  assert.equal(individualScore([kpi(5, "50"), kpi(5, "50")]).toString(), "5");
  assert.equal(individualScore([kpi(1, "50"), kpi(1, "50")]).toString(), "1");
});

test("§8.2 thirds sum exactly — the case floating point gets wrong", () => {
  // 33.33 + 33.33 + 33.34 weightages at mixed levels. In IEEE-754 this drifts;
  // the result here is exact, which is what §8.7's boundaries depend on.
  const score = individualScore([kpi(5, "33.33"), kpi(4, "33.33"), kpi(3, "33.34")]);
  assert.equal(score.toString(), "3.9999");
});

test("§5.3 a set that does not total 100 is REFUSED, not scored", () => {
  // Scoring a 90% set silently produces a number on no scale at all, biased
  // against whoever's weightage went missing.
  assert.throws(() => individualScore([kpi(3, "40"), kpi(3, "50")]), /total 90%/);
});

test("§8.1 a level outside 1-5 is refused", () => {
  assert.throws(() => individualScore([kpi(0, "100")]), /not a level/);
  assert.throws(() => individualScore([kpi(6, "100")]), /not a level/);
  assert.throws(() => individualScore([kpi(3.5, "100")]), /not a level/);
});

test("§8.2 an empty set has no score, rather than a misleading zero", () => {
  assert.throws(() => individualScore([]), /empty KPI set/);
});

// --- §8.5, using the spec's example ----------------------------------------------

test("§8.5 the 360 ratio becomes its 1-5 equivalent — the spec's 0.92 → 4.60", () => {
  assert.equal(threeSixtyAsLevel("0.92").toString(), "4.6");
  assert.equal(threeSixtyAsLevel("1").toString(), "5");
  assert.equal(threeSixtyAsLevel("0").toString(), "0");
});

test("§9.5 a ratio outside 0-1 is refused", () => {
  assert.throws(() => threeSixtyAsLevel("1.2"), /between 0 and 1/);
  assert.throws(() => threeSixtyAsLevel("-0.1"), /between 0 and 1/);
});

// --- §8.3's weight table, exactly as printed --------------------------------------

test("§8.3 the weight table matches the specification row for row", () => {
  assert.deepEqual(TRACK_WEIGHTS.DIRECTOR, {
    corporate: 30,
    departmental: 40,
    individual: 10,
    threeSixty: 20,
  });
  assert.deepEqual(TRACK_WEIGHTS.MANAGER, {
    corporate: 20,
    departmental: 50,
    individual: 10,
    threeSixty: 20,
  });
  assert.deepEqual(TRACK_WEIGHTS.LEAD, {
    corporate: 10,
    departmental: 60,
    individual: 10,
    threeSixty: 20,
  });
  assert.deepEqual(TRACK_WEIGHTS.INDIVIDUAL, {
    corporate: 10,
    departmental: null,
    individual: 80,
    threeSixty: 10,
  });
});

test("§8.3 every track's weights total 100", () => {
  for (const [track, w] of Object.entries(TRACK_WEIGHTS)) {
    const total = w.corporate + (w.departmental ?? 0) + w.individual + w.threeSixty;
    assert.equal(total, 100, `${track} weights must total 100`);
  }
});

// --- §8.6, using the spec's Individual-track example -------------------------------

test("§8.6 the spec's Individual-track formula", () => {
  // "Final = (Individual × 80%) + (360(1–5) × 10%) + (Corporate × 10%)"
  // Individual 4, 360 ratio 0.92 → 4.60, Corporate 3:
  //   3.20 + 0.46 + 0.30 = 3.96
  const score = finalScore("INDIVIDUAL", {
    corporate: "3",
    departmental: null,
    individual: "4",
    threeSixty: threeSixtyAsLevel("0.92"),
  });
  assert.equal(score.toString(), "3.96");
});

test("§8.6 a Director's four components", () => {
  // 30% + 40% + 10% + 20%, all at Target(3) → exactly 3.
  assert.equal(
    finalScore("DIRECTOR", {
      corporate: "3",
      departmental: "3",
      individual: "3",
      threeSixty: "3",
    }).toString(),
    "3",
  );
  // 4 / 5 / 3 / 4.6 → 1.20 + 2.00 + 0.30 + 0.92 = 4.42
  assert.equal(
    finalScore("DIRECTOR", {
      corporate: "4",
      departmental: "5",
      individual: "3",
      threeSixty: "4.6",
    }).toString(),
    "4.42",
  );
});

test("§8.3 C-Level bypass the formula entirely — the entity score passes through", () => {
  const score = finalScore("C_LEVEL", {
    corporate: "4.2",
    // Everything else is ignored: they have no KPIs, no self-assessment, no 360.
    departmental: "1",
    individual: "1",
    threeSixty: "1",
  });
  assert.equal(score.toString(), "4.2");
});

test("§8.3 an Individual supplied a Departmental score is REFUSED, not silently zeroed", () => {
  // A zero weight would multiply the mis-keyed figure away and hide the error.
  assert.throws(
    () =>
      finalScore("INDIVIDUAL", {
        corporate: "3",
        departmental: "4",
        individual: "3",
        threeSixty: "3",
      }),
    /no Departmental component/,
  );
});

test("§8.3 a Manager MISSING a Departmental score is refused too", () => {
  assert.throws(
    () =>
      finalScore("MANAGER", {
        corporate: "3",
        departmental: null,
        individual: "3",
        threeSixty: "3",
      }),
    /requires a Departmental score/,
  );
});

// --- §8.7's band table, at every boundary the spec prints --------------------------

test("§8.7 each band's stated endpoints map as printed", () => {
  const cases: [string, string][] = [
    ["5.00", "OUTSTANDING"],
    ["4.50", "OUTSTANDING"],
    ["4.49", "EXCELLENT"],
    ["4.00", "EXCELLENT"],
    ["3.99", "TARGET"],
    ["3.00", "TARGET"],
    ["2.99", "ALMOST_ACHIEVED"],
    ["2.00", "ALMOST_ACHIEVED"],
    ["1.99", "UNSATISFACTORY"],
    ["1.00", "UNSATISFACTORY"],
  ];
  for (const [score, band] of cases) {
    assert.equal(bandFor(score), band, `${score} must be ${band}`);
  }
});

test("§8.7 the boundaries are exact, not floating point", () => {
  // 4.50 must be Outstanding. A float pipeline that produced 4.499999999999999
  // would band this Excellent — a different bonus coefficient (§11.3) and a
  // different answer to the employee.
  assert.equal(bandFor("4.5"), "OUTSTANDING");
  assert.equal(
    bandFor(
      finalScore("DIRECTOR", {
        corporate: "4.5",
        departmental: "4.5",
        individual: "4.5",
        threeSixty: "4.5",
      }),
    ),
    "OUTSTANDING",
  );
});

test("§8.7 the gap the spec's table leaves is closed, and stated", () => {
  // The table prints 4.00–4.49 and 4.50–5.00, so 4.495 belongs to no band as
  // written. Thresholds are `>=`, the only reading under which every score maps.
  assert.equal(bandFor("4.495"), "EXCELLENT");
  assert.equal(bandFor("3.995"), "TARGET");
});

// --- §11.3's coefficients ----------------------------------------------------------

test("§11.3 the band coefficients match the specification", () => {
  assert.equal(BAND_COEFFICIENT.OUTSTANDING, 2.0);
  assert.equal(BAND_COEFFICIENT.EXCELLENT, 1.5);
  assert.equal(BAND_COEFFICIENT.TARGET, 1.0);
  assert.equal(BAND_COEFFICIENT.ALMOST_ACHIEVED, 0);
  assert.equal(BAND_COEFFICIENT.UNSATISFACTORY, 0);
});

test("§11.3 the two bottom bands earn nothing — not a token amount", () => {
  assert.equal(BAND_COEFFICIENT.ALMOST_ACHIEVED, 0);
  assert.equal(BAND_COEFFICIENT.UNSATISFACTORY, 0);
});

// --- §10.7 — the signatures are a PRECONDITION of scoring -------------------

const D = (v: string) => new Prisma.Decimal(v);

/** A complete, signed INDIVIDUAL chain. Each test takes away one thing. */
const chain = (over: Record<string, unknown> = {}) =>
  scoreEmployee({
    employeeId: "emp-1",
    roleTrack: "INDIVIDUAL",
    corporate: D("4.20"),
    departmental: null,
    kpis: [
      { description: "Delivery", level: 4, weightage: "50" },
      { description: "Quality", level: 3, weightage: "30" },
      { description: "Collaboration", level: 5, weightage: "20" },
    ],
    threeSixty: D("4.60"),
    signedParties: ["EMPLOYEE", "MANAGER"],
    ...over,
  } as never);

test("§10.7 a complete, signed chain scores — and the number is the one §8.6 gives", () => {
  const out = chain();
  assert.equal(out.scored, true);
  if (!out.scored) return;
  // 4.20x10% + 3.90x80% + 4.60x10% = 0.42 + 3.12 + 0.46
  assert.equal(String(out.individual), "3.9");
  assert.equal(String(out.raw), "4");
  assert.equal(out.band, "EXCELLENT");
});

test("§10.7 an UNSIGNED assessment is not scored, and says who has not signed", () => {
  // §10.7 sequences the score run after "assessments completed & signed". Before
  // this, scoring read ratings and never looked at a signature, so an employee
  // nobody had signed off could be scored, calibrated and published — and the
  // numbers would have been right, which is what made it invisible.
  const neither = chain({ signedParties: [] });
  assert.equal(neither.scored, false);
  if (neither.scored) return;
  assert.match(neither.reason, /§10\.7/);
  assert.match(neither.reason, /employee/i);
  assert.match(neither.reason, /manager/i);

  const employeeOnly = chain({ signedParties: ["EMPLOYEE"] });
  assert.equal(employeeOnly.scored, false);
  if (employeeOnly.scored) return;
  assert.match(employeeOnly.reason, /manager/i, "it must name the party still missing");
  assert.doesNotMatch(employeeOnly.reason, /the employee has not/i);

  const managerOnly = chain({ signedParties: ["MANAGER"] });
  assert.equal(managerOnly.scored, false);
  if (managerOnly.scored) return;
  assert.match(managerOnly.reason, /employee/i);
});

test("§8.3 C-Level are exempt: they have no self-assessment to sign", () => {
  // Requiring a signature from someone the spec excuses from assessing entirely
  // would refuse to score the very people §8.3 makes simplest.
  const out = scoreEmployee({
    employeeId: "ceo-1",
    roleTrack: "C_LEVEL",
    corporate: D("4.20"),
    departmental: null,
    kpis: [],
    threeSixty: null,
    signedParties: [],
  } as never);
  assert.equal(out.scored, true);
  if (!out.scored) return;
  assert.equal(String(out.raw), "4.2");
});

test("an UNRATED KPI blames the manager's review, not the weightages", () => {
  // The old behaviour: the route dropped unrated KPIs, the weights then totalled
  // less than 100, and HR was told "weightages total 70%, not 100" — which sends
  // them to the goal-setting baseline when the actual cause is a manager who has
  // not finished reviewing.
  const out = chain({
    kpis: [
      { description: "Delivery", level: 4, weightage: "50" },
      { description: "Quality", level: null, weightage: "30" },
      { description: "Collaboration", level: null, weightage: "20" },
    ],
  });
  assert.equal(out.scored, false);
  if (out.scored) return;
  assert.match(out.reason, /2 of 3/, "it should count them");
  assert.match(out.reason, /Quality/, "and name the first one");
  assert.match(out.reason, /§7\.1/);
  assert.doesNotMatch(out.reason, /weightage/i, "the weightages are not the problem");
});

test("a genuinely unbalanced set still reports §5.3, because that IS the problem", () => {
  const out = chain({
    kpis: [{ description: "Delivery", level: 4, weightage: "70" }],
  });
  assert.equal(out.scored, false);
  if (out.scored) return;
  assert.match(out.reason, /§5\.3/);
  assert.match(out.reason, /70%/);
});
