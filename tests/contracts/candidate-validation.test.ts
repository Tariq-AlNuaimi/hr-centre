import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentSchema,
  responseSchema,
} from "../../lib/validations/candidate";

// The candidate runner is an UNAUTHENTICATED, token-authorized public surface
// (UI-SPEC C.1–C.4). These lock the zod boundary that every candidate write
// crosses — a bad value must be a 422, never a 500 or a silent bad write.

test("consent requires the literal true (a false/missing flag is rejected)", () => {
  assert.equal(consentSchema.safeParse({ consent: true }).success, true);
  assert.equal(consentSchema.safeParse({ consent: true, locale: "ar" }).success, true);
  assert.equal(consentSchema.safeParse({ consent: false }).success, false);
  assert.equal(consentSchema.safeParse({}).success, false);
  // An unsupported locale is rejected.
  assert.equal(consentSchema.safeParse({ consent: true, locale: "fr" }).success, false);
});

test("item response: itemNumber 1..120 and value 1..5, integers only", () => {
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 1, value: 1 }).success, true);
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 120, value: 5 }).success, true);
  // Out of range
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 0, value: 3 }).success, false);
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 121, value: 3 }).success, false);
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 5, value: 0 }).success, false);
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 5, value: 6 }).success, false);
  // Non-integer
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 5, value: 2.5 }).success, false);
});

test("sjt response: requires a cuid item id + a non-empty option id", () => {
  const okSjt = responseSchema.safeParse({
    kind: "sjt",
    sjtItemId: "clvz0000000000000000abcd",
    chosenOptionId: "opt-a",
  });
  assert.equal(okSjt.success, true);
  // Empty option id rejected
  assert.equal(
    responseSchema.safeParse({ kind: "sjt", sjtItemId: "clvz0000000000000000abcd", chosenOptionId: "" }).success,
    false
  );
});

test("discriminated union rejects an unknown kind / mixed payload", () => {
  assert.equal(responseSchema.safeParse({ kind: "other", value: 3 }).success, false);
  // item payload missing value
  assert.equal(responseSchema.safeParse({ kind: "item", itemNumber: 5 }).success, false);
});
