import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAssessmentSchema,
  DIMENSION_VALUES,
} from "../../lib/validations/assessment";
import { DIMENSION_META, DIMENSION_ORDER } from "../../lib/testing/dimensions";

// Vibe Inspector (ADR-015) — boundary-validation + catalog contracts. Pure: no DB,
// no network, no engine (the Browserbase/Claude calls aren't exercised here).

test("createAssessmentSchema accepts a valid assessment", () => {
  const parsed = createAssessmentSchema.safeParse({
    name: "Acme review",
    targetUrl: "https://acme.example.com",
    brdText: "Users can sign up and log in.",
    dimensions: ["DESIGN", "BRD_COVERAGE"],
  });
  assert.equal(parsed.success, true);
});

test("createAssessmentSchema accepts a bare host (protocol added at capture)", () => {
  const parsed = createAssessmentSchema.safeParse({
    name: "Acme",
    targetUrl: "acme.example.com",
    dimensions: ["DESIGN"],
  });
  assert.equal(parsed.success, true);
});

test("createAssessmentSchema rejects an invalid URL", () => {
  const parsed = createAssessmentSchema.safeParse({
    name: "Bad",
    targetUrl: "not a url",
    dimensions: ["DESIGN"],
  });
  assert.equal(parsed.success, false);
});

test("createAssessmentSchema requires at least one dimension", () => {
  const parsed = createAssessmentSchema.safeParse({
    name: "Empty dims",
    targetUrl: "https://acme.example.com",
    dimensions: [],
  });
  assert.equal(parsed.success, false);
});

test("createAssessmentSchema rejects an unknown dimension", () => {
  const parsed = createAssessmentSchema.safeParse({
    name: "Bad dim",
    targetUrl: "https://acme.example.com",
    dimensions: ["NONSENSE"],
  });
  assert.equal(parsed.success, false);
});

test("brdText defaults to empty string when omitted", () => {
  const parsed = createAssessmentSchema.parse({
    name: "No BRD",
    targetUrl: "https://acme.example.com",
    dimensions: ["SECURITY"],
  });
  assert.equal(parsed.brdText, "");
});

test("dimension catalog covers every validation value and the prisma enum order", () => {
  // Every value the API accepts must have catalog metadata...
  for (const d of DIMENSION_VALUES) {
    assert.ok(DIMENSION_META[d], `missing DIMENSION_META for ${d}`);
    assert.ok(DIMENSION_META[d].label.length > 0, `empty label for ${d}`);
  }
  // ...and the render order must match the accepted value set exactly.
  assert.deepEqual([...DIMENSION_ORDER].sort(), [...DIMENSION_VALUES].sort());
});
