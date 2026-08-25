import test from "node:test";
import assert from "node:assert/strict";

import {
  minimalEdit,
  proposedTotal,
  type ComposerKpi,
  type Draft,
} from "../../components/pms/change-request-draft";

/**
 * The two pure functions the §6 composer runs on every keystroke.
 *
 * Both were caught by a browser pass rather than by reasoning, and both fail
 * silently rather than loudly, which is why they are pinned here:
 *
 *  - `proposedTotal` decides whether §5.3 is satisfied. Done in floats it
 *    refuses a correctly balanced set of thirds.
 *  - `minimalEdit` decides what a change request RECORDS. Sending the composer's
 *    prefilled fields back made §6.3's permanent history claim six untouched
 *    fields had changed, and HR's diff read "X → X".
 */

const kpi = (id: string, weightage: string, over: Partial<ComposerKpi> = {}): ComposerKpi => ({
  id,
  description: `KPI ${id}`,
  weightage,
  descriptorOutstanding: "o",
  descriptorExcellent: "e",
  descriptorTarget: "t",
  descriptorAlmostAchieved: "a",
  descriptorUnsatisfactory: "u",
  ...over,
});

const draftOf = (k: ComposerKpi, over: Partial<Draft> = {}): Draft => ({
  kpiId: k.id,
  description: k.description,
  weightage: k.weightage,
  descriptorOutstanding: k.descriptorOutstanding,
  descriptorExcellent: k.descriptorExcellent,
  descriptorTarget: k.descriptorTarget,
  descriptorAlmostAchieved: k.descriptorAlmostAchieved,
  descriptorUnsatisfactory: k.descriptorUnsatisfactory,
  ...over,
});

const SET = [kpi("k1", "40"), kpi("k2", "35"), kpi("k3", "25")];

// --- §5.3, in exact arithmetic ------------------------------------------------

test("§5.3 an untouched set totals exactly what it weighs", () => {
  assert.equal(proposedTotal(SET, {}), "100");
});

test("§5.3 three thirds land on 100 — the case floats get wrong", () => {
  // 33.33 + 33.33 + 33.34 in IEEE-754 is 100.00000000000001, which would show a
  // correctly balanced manager a refusal.
  const thirds = [kpi("a", "33.33"), kpi("b", "33.33"), kpi("c", "33.34")];
  assert.equal(proposedTotal(thirds, {}), "100");
});

test("§5.3 0.1 + 0.2 is 0.30 here — the sum IEEE-754 cannot promise", () => {
  // Two decimals always, matching `Decimal(5,2)`: a percentage rendered as
  // "0.3" one moment and "0.30" the next reads as two different numbers.
  assert.equal(proposedTotal([kpi("a", "0.1"), kpi("b", "0.2")], {}), "0.30");
});

test("§5.3 a draft weightage replaces the live one in the running total", () => {
  const drafts = { k1: draftOf(SET[0], { weightage: "30" }) };
  assert.equal(proposedTotal(SET, drafts), "90");
});

test("a half-typed weightage reads as unknown, never as a total", () => {
  // Mid-keystroke the box holds "" or "3." — reporting 65% would tell the
  // manager their set is unbalanced when they are simply still typing.
  for (const partial of ["", "3.", "abc", "1000"]) {
    assert.equal(proposedTotal(SET, { k1: draftOf(SET[0], { weightage: partial }) }), "—");
  }
});

test("a two-decimal total is rendered with both decimals", () => {
  assert.equal(proposedTotal([kpi("a", "0.05"), kpi("b", "0.5")], {}), "0.55");
});

// --- what a request actually records ------------------------------------------

test("§6.3 an untouched draft records nothing at all", () => {
  // The composer prefills every field. If that came back as an edit, the history
  // would say seven fields changed when the manager opened a KPI and closed it.
  assert.equal(minimalEdit(SET[0], draftOf(SET[0])), null);
});

test("§6.3 only the field that moved is recorded", () => {
  const edit = minimalEdit(SET[0], draftOf(SET[0], { weightage: "30" }));
  assert.deepEqual(edit, { kpiId: "k1", weightage: "30" });
  assert.equal(
    Object.keys(edit as object).length,
    2,
    "kpiId plus one field — the other six stay absent, which is how §6.2 says 'unchanged'",
  );
});

test("§6.3 a full overhaul records all seven", () => {
  const edit = minimalEdit(
    SET[0],
    draftOf(SET[0], {
      description: "New",
      weightage: "50",
      descriptorOutstanding: "O",
      descriptorExcellent: "E",
      descriptorTarget: "T",
      descriptorAlmostAchieved: "A",
      descriptorUnsatisfactory: "U",
    }),
  );
  assert.equal(Object.keys(edit as object).length, 8, "kpiId plus seven fields");
});

test("§6.3 a descriptor edit does not drag the weightage along with it", () => {
  const edit = minimalEdit(SET[0], draftOf(SET[0], { descriptorTarget: "Reworded" }));
  assert.deepEqual(edit, { kpiId: "k1", descriptorTarget: "Reworded" });
  assert.ok(!("weightage" in (edit as object)), "an unchanged weightage is not an edit");
});
