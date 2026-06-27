import { test } from "node:test";
import assert from "node:assert/strict";
import { IPIP_NEO_120 } from "../../prisma/data/ipip-neo-120";

// The seed loads this generated dataset (services/scoring/scripts/gen_items.py).
// These invariants lock the IPIP-NEO-120 structure so a bad regeneration can't
// silently ship a malformed instrument (ARCHITECTURE §12.2, UI-SPEC C.2).

const DOMAINS = [
  "OPENNESS",
  "CONSCIENTIOUSNESS",
  "EXTRAVERSION",
  "AGREEABLENESS",
  "NEUROTICISM",
] as const;

// The five-factor-e facet labels per domain (model.py Big5* enums).
const FACETS: Record<string, string[]> = {
  NEUROTICISM: ["anxiety", "anger", "depression", "self_consciousness", "immoderation", "vulnerability"],
  EXTRAVERSION: ["friendliness", "gregariousness", "assertiveness", "activity_level", "excitement_seeking", "cheerfulness"],
  OPENNESS: ["imagination", "artistic_interests", "emotionality", "adventurousness", "intellect", "liberalism"],
  AGREEABLENESS: ["trust", "morality", "altruism", "cooperation", "modesty", "sympathy"],
  CONSCIENTIOUSNESS: ["self_efficacy", "orderliness", "dutifulness", "achievement_striving", "self_discipline", "cautiousness"],
};

test("item bank has exactly 120 items", () => {
  assert.equal(IPIP_NEO_120.length, 120);
});

test("itemNumbers are 1..120 unique; itemCodes unique and zero-padded", () => {
  const numbers = IPIP_NEO_120.map((i) => i.itemNumber).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 120 }, (_, k) => k + 1));
  assert.equal(new Set(IPIP_NEO_120.map((i) => i.itemCode)).size, 120);
  for (const item of IPIP_NEO_120) {
    assert.equal(item.itemCode, `IPIP120-${String(item.itemNumber).padStart(3, "0")}`);
  }
});

test("5 domains × 6 facets × 4 items, with the right facet labels", () => {
  for (const domain of DOMAINS) {
    const inDomain = IPIP_NEO_120.filter((i) => i.domain === domain);
    assert.equal(inDomain.length, 24, `${domain} should have 24 items`);
    for (let n = 1; n <= 6; n++) {
      const facetItems = inDomain.filter((i) => i.facetNumber === n);
      assert.equal(facetItems.length, 4, `${domain} facet ${n} should have 4 items`);
      // all four items of a facet carry the same facet label
      const labels = new Set(facetItems.map((i) => i.facet));
      assert.equal(labels.size, 1);
      assert.equal([...labels][0], FACETS[domain][n - 1]);
    }
  }
});

test("exactly 55 items are reverse-keyed (MINUS)", () => {
  const reversed = IPIP_NEO_120.filter((i) => i.keyed === "MINUS");
  assert.equal(reversed.length, 55);
  for (const item of IPIP_NEO_120) {
    assert.ok(item.keyed === "PLUS" || item.keyed === "MINUS");
  }
});

test("every item has non-empty English text; Arabic is left for editing", () => {
  for (const item of IPIP_NEO_120) {
    assert.ok(item.text_en.length > 0, `item ${item.itemNumber} missing text_en`);
    assert.ok(!("text_ar" in item) || item.text_ar == null || typeof item.text_ar === "string");
  }
});

test("the canonical first items match the published IPIP-NEO-120 key", () => {
  // Spot-check the interleaved N,E,O,A,C ordering at the head + a known
  // reverse-keyed item, so a reshuffled regeneration fails loudly.
  const byNum = new Map(IPIP_NEO_120.map((i) => [i.itemNumber, i]));
  assert.equal(byNum.get(1)!.domain, "NEUROTICISM");
  assert.equal(byNum.get(1)!.facet, "anxiety");
  assert.equal(byNum.get(1)!.keyed, "PLUS");
  assert.equal(byNum.get(2)!.domain, "EXTRAVERSION");
  assert.equal(byNum.get(3)!.domain, "OPENNESS");
  assert.equal(byNum.get(9)!.domain, "AGREEABLENESS");
  assert.equal(byNum.get(9)!.keyed, "MINUS");
});
