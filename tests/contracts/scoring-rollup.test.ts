import { test } from "node:test";
import assert from "node:assert/strict";
import {
  facetContribution,
  bandFor,
  scoreSjt,
  scoreCompetency,
  rollUp,
  type FacetScoreRow,
  type RollupCompetency,
} from "../../lib/scoring-rollup";
import type { ScoreResponse } from "../../lib/validations/scoring";

// Pure roll-up (ARCHITECTURE §6). These lock the deterministic scoring math: the
// direction-normalized facet contribution, the band thresholds, the SJT judgement
// signal (key never leaks), and the weighted fit aggregate. No DB, no service.

// ---- facetContribution ----

test("facetContribution HIGH returns the percentile", () => {
  assert.equal(facetContribution(80, "HIGH", 70), 80);
  assert.equal(facetContribution(20, "HIGH", 70), 20);
});

test("facetContribution LOW inverts the percentile (low trait = high fit)", () => {
  assert.equal(facetContribution(20, "LOW", 30), 80);
  assert.equal(facetContribution(90, "LOW", 30), 10);
});

test("facetContribution MODERATE peaks at the target and falls off both sides", () => {
  assert.equal(facetContribution(50, "MODERATE", 50), 100); // on target
  assert.equal(facetContribution(60, "MODERATE", 50), 80); // 10 off → 100-20
  assert.equal(facetContribution(40, "MODERATE", 50), 80); // symmetric
  assert.equal(facetContribution(0, "MODERATE", 50), 0); // far off, clamped at 0
});

test("facetContribution clamps to [0,100]", () => {
  assert.equal(facetContribution(120, "HIGH", 50), 100);
  assert.equal(facetContribution(-5, "HIGH", 50), 0);
  assert.equal(facetContribution(200, "MODERATE", 50), 0);
});

// ---- bandFor ----

test("bandFor: PASS at/above target, PARTIAL within 15 below, BELOW under that", () => {
  assert.equal(bandFor(70, 70), "PASS");
  assert.equal(bandFor(85, 70), "PASS");
  assert.equal(bandFor(69, 70), "PARTIAL");
  assert.equal(bandFor(55, 70), "PARTIAL"); // exactly target-15
  assert.equal(bandFor(54, 70), "BELOW");
  assert.equal(bandFor(0, 50), "BELOW");
});

// ---- scoreSjt (key never leaks; only derived scores returned) ----

const SJT_ITEMS = [
  { id: "s1", bestOptionId: "a", worstOptionId: "d" },
  { id: "s2", bestOptionId: "b", worstOptionId: "c" },
  { id: "s3", bestOptionId: "a", worstOptionId: null },
];

test("scoreSjt scores best=1, worst=0, other=0.5, unanswered=null and averages answered", () => {
  const res = scoreSjt(SJT_ITEMS, [
    { sjtItemId: "s1", chosenOptionId: "a" }, // best → 1
    { sjtItemId: "s2", chosenOptionId: "c" }, // worst → 0
    { sjtItemId: "s3", chosenOptionId: "x" }, // other → 0.5
  ]);
  assert.equal(res.total, 3);
  assert.equal(res.answered, 3);
  // mean(1, 0, 0.5) = 0.5 → 50
  assert.equal(res.overall, 50);
  assert.deepEqual(
    res.items.map((i) => i.choice),
    ["best", "worst", "other"]
  );
});

test("scoreSjt excludes unanswered items from the mean and reports overall=null when none answered", () => {
  const partial = scoreSjt(SJT_ITEMS, [{ sjtItemId: "s1", chosenOptionId: "a" }]);
  assert.equal(partial.answered, 1);
  assert.equal(partial.overall, 100); // only the best answer counts
  assert.equal(partial.items[1].choice, "unanswered");
  assert.equal(partial.items[1].score, null);

  const none = scoreSjt(SJT_ITEMS, []);
  assert.equal(none.overall, null);
  assert.equal(none.answered, 0);
});

test("scoreSjt does not expose the key (only sjtItemId/choice/score)", () => {
  const res = scoreSjt(SJT_ITEMS, [{ sjtItemId: "s1", chosenOptionId: "a" }]);
  const keys = Object.keys(res.items[0]).sort();
  assert.deepEqual(keys, ["choice", "score", "sjtItemId"]);
});

// ---- scoreCompetency ----

function facetMap(entries: Array<[string, number]>): Map<string, FacetScoreRow> {
  const m = new Map<string, FacetScoreRow>();
  for (const [facet, percentile] of entries) {
    m.set(facet, { facet, facetNumber: 1, domain: "CONSCIENTIOUSNESS", raw: 0, percentile, band: "average" });
  }
  return m;
}

test("scoreCompetency averages mapped facet contributions and bands the result", () => {
  const comp: RollupCompetency = {
    name: "Drive",
    weight: 2,
    direction: "HIGH",
    targetPercentile: 70,
    facets: ["achievement_striving", "self_discipline"],
  };
  const row = scoreCompetency(comp, facetMap([
    ["achievement_striving", 80],
    ["self_discipline", 60],
  ]));
  assert.equal(row.score, 70); // mean(80,60)
  assert.equal(row.band, "PASS");
  assert.equal(row.drivers.length, 2);
  assert.equal(row.drivers[0].contribution, 80);
});

test("scoreCompetency skips facets the scorer didn't return", () => {
  const comp: RollupCompetency = {
    name: "Resilience",
    weight: 1,
    direction: "LOW",
    targetPercentile: 60,
    facets: ["vulnerability", "missing_facet"],
  };
  const row = scoreCompetency(comp, facetMap([["vulnerability", 20]]));
  assert.equal(row.drivers.length, 1);
  assert.equal(row.score, 80); // LOW: 100-20
  assert.equal(row.band, "PASS");
});

test("scoreCompetency with no resolvable facets scores 0 / BELOW (defensive)", () => {
  const comp: RollupCompetency = {
    name: "Ghost",
    weight: 1,
    direction: "HIGH",
    targetPercentile: 50,
    facets: ["nope"],
  };
  const row = scoreCompetency(comp, facetMap([["other", 90]]));
  assert.equal(row.score, 0);
  assert.equal(row.band, "BELOW");
  assert.equal(row.drivers.length, 0);
});

// ---- rollUp (full) ----

function buildScore(percentileByFacet: Record<string, number>): ScoreResponse {
  const domainsDef: Array<[ScoreResponse["domains"][number]["domain"], string[]]> = [
    ["CONSCIENTIOUSNESS", ["self_efficacy", "orderliness", "dutifulness", "achievement_striving", "self_discipline", "cautiousness"]],
    ["NEUROTICISM", ["anxiety", "anger", "depression", "self_consciousness", "immoderation", "vulnerability"]],
    ["EXTRAVERSION", ["friendliness", "gregariousness", "assertiveness", "activity_level", "excitement_seeking", "cheerfulness"]],
    ["AGREEABLENESS", ["trust", "morality", "altruism", "cooperation", "modesty", "sympathy"]],
    ["OPENNESS", ["imagination", "artistic_interests", "emotionality", "adventurousness", "intellect", "liberalism"]],
  ];
  return {
    model: "IPIP-NEO-120",
    deterministic: true,
    norms: { source: "Johnson 2014", via: "five-factor-e", sex: "N", age: 30 },
    domains: domainsDef.map(([domain, facets]) => {
      const facetRows = facets.map((facet, i) => {
        const percentile = percentileByFacet[facet] ?? 50;
        return { facet, facetNumber: i + 1, raw: 12, percentile, score: "average" as const };
      });
      const avg = facetRows.reduce((a, f) => a + f.percentile, 0) / facetRows.length;
      return { domain, raw: 60, percentile: Math.round(avg), score: "average" as const, facets: facetRows };
    }),
  };
}

test("rollUp produces 30 facet rows, 5 domain rows, and a weighted fit score", () => {
  const score = buildScore({ achievement_striving: 90, self_discipline: 70, vulnerability: 20 });
  const competencies: RollupCompetency[] = [
    { name: "Drive", weight: 3, direction: "HIGH", targetPercentile: 70, facets: ["achievement_striving", "self_discipline"] },
    { name: "Resilience", weight: 1, direction: "LOW", targetPercentile: 60, facets: ["vulnerability"] },
  ];
  const res = rollUp({ score, competencies, sjtItems: SJT_ITEMS, sjtResponses: [{ sjtItemId: "s1", chosenOptionId: "a" }] });

  assert.equal(res.facetScores.length, 30);
  assert.equal(res.domainScores.length, 5);
  assert.equal(res.competencyScores.length, 2);

  // Drive = mean(90,70)=80; Resilience = 100-20=80. Weighted: (80*3 + 80*1)/4 = 80.
  assert.equal(res.competencyScores[0].score, 80);
  assert.equal(res.competencyScores[1].score, 80);
  assert.equal(res.fitScore, 80);
  assert.equal(res.competencyScores[0].band, "PASS");
});

test("rollUp communityPercentile is the mean of the 5 domain percentiles", () => {
  const score = buildScore({});
  const res = rollUp({ score, competencies: [], sjtItems: [], sjtResponses: [] });
  assert.equal(res.communityPercentile, 50); // all facets default to 50
});

test("rollUp with no competencies yields fitScore 0 (honest, not a crash)", () => {
  const score = buildScore({});
  const res = rollUp({ score, competencies: [], sjtItems: [], sjtResponses: [] });
  assert.equal(res.fitScore, 0);
  assert.equal(res.competencyScores.length, 0);
});

test("rollUp fit is weight-sensitive (a heavy weak competency drags fit down)", () => {
  const score = buildScore({ achievement_striving: 90, anxiety: 90 });
  const competencies: RollupCompetency[] = [
    { name: "Strong", weight: 1, direction: "HIGH", targetPercentile: 50, facets: ["achievement_striving"] }, // 90
    { name: "WeakHeavy", weight: 4, direction: "LOW", targetPercentile: 50, facets: ["anxiety"] }, // 100-90=10
  ];
  const res = rollUp({ score, competencies, sjtItems: [], sjtResponses: [] });
  // (90*1 + 10*4)/5 = 26
  assert.equal(res.fitScore, 26);
});
