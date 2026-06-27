import { test } from "node:test";
import assert from "node:assert/strict";
import {
  competencyInputSchema,
  sjtItemInputSchema,
  createRoleProfileSchema,
  llmDraftResponseSchema,
} from "../../lib/validations/roleProfile";

// Boundary validation for role-profile authoring. The AI draft is held to the SAME
// competency contract as a human-authored one (llmDraftResponseSchema reuses
// competencyInputSchema), so an off-contract model response is rejected, not stored.

const validCompetency = {
  name: "Achievement / Drive",
  weight: 1.2,
  direction: "HIGH" as const,
  targetPercentile: 70,
  facets: ["achievement_striving"],
};

test("competency: applies defaults and accepts a valid row", () => {
  const parsed = competencyInputSchema.parse({ name: "Resilience", facets: ["vulnerability"] });
  assert.equal(parsed.weight, 1); // default
  assert.equal(parsed.direction, "HIGH"); // default
  assert.equal(parsed.targetPercentile, 50); // default
});

test("competency: rejects an unknown facet", () => {
  const r = competencyInputSchema.safeParse({ ...validCompetency, facets: ["telepathy"] });
  assert.equal(r.success, false);
});

test("competency: rejects empty facets, non-positive weight, out-of-range band", () => {
  assert.equal(competencyInputSchema.safeParse({ ...validCompetency, facets: [] }).success, false);
  assert.equal(competencyInputSchema.safeParse({ ...validCompetency, weight: 0 }).success, false);
  assert.equal(competencyInputSchema.safeParse({ ...validCompetency, targetPercentile: 0 }).success, false);
  assert.equal(competencyInputSchema.safeParse({ ...validCompetency, targetPercentile: 100 }).success, false);
});

test("sjt: scoringKey must reference an existing option id", () => {
  const base = {
    scenario_en: "A client escalates angrily on a Friday call.",
    options: [
      { id: "a", text_en: "De-escalate and schedule a follow-up." },
      { id: "b", text_en: "End the call." },
    ],
  };
  assert.equal(
    sjtItemInputSchema.safeParse({ ...base, scoringKey: { bestOptionId: "a", worstOptionId: "b" } }).success,
    true
  );
  // bestOptionId not an option id
  assert.equal(
    sjtItemInputSchema.safeParse({ ...base, scoringKey: { bestOptionId: "z" } }).success,
    false
  );
  // duplicate option ids
  assert.equal(
    sjtItemInputSchema.safeParse({
      scenario_en: base.scenario_en,
      options: [
        { id: "a", text_en: "x" },
        { id: "a", text_en: "y" },
      ],
      scoringKey: { bestOptionId: "a" },
    }).success,
    false
  );
});

test("createRoleProfile: competencies default to empty (blank wizard) and cuid family id required", () => {
  const ok = createRoleProfileSchema.safeParse({
    roleFamilyId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
    title: "Sales Executive",
  });
  assert.equal(ok.success, true);
  if (ok.success) assert.deepEqual(ok.data.competencies, []);

  const badId = createRoleProfileSchema.safeParse({ roleFamilyId: "not-a-cuid", title: "X" });
  assert.equal(badId.success, false);
});

test("llmDraftResponse: requires >=1 competency and enforces the competency contract", () => {
  assert.equal(llmDraftResponseSchema.safeParse({ competencies: [] }).success, false);
  assert.equal(
    llmDraftResponseSchema.safeParse({ competencies: [validCompetency] }).success,
    true
  );
  // a single off-contract competency invalidates the whole draft
  assert.equal(
    llmDraftResponseSchema.safeParse({
      competencies: [validCompetency, { ...validCompetency, facets: ["nope"] }],
    }).success,
    false
  );
});
