// Unit coverage for the V2-305 copy-lint gate (scripts/copy-check.mjs).
//
// The gate holds source-locale UI copy to a small deterministic house style so a
// considered voice can't drift string-by-string. These tests prove the gate DENIES the
// bad cases (Title Case, a trailing period on a label, a banned term) AND ALLOWS the good
// cases (sentence case, ellipsis, proper nouns, acronyms, real sentences, placeholders) —
// the negative-test discipline the harness requires of every gate.
//
// Run via `npm run test:hooks` (node --test tests/harness/*.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkValue,
  checkMessages,
  flattenMessages,
  loadConfig,
} from "../../scripts/copy-check.mjs";

// A config independent of the repo's project.config.json, so the test is hermetic.
const config = {
  properNouns: new Set(["App", "Microsoft", "ID", "SSO", "OK"]),
  terminology: [{ term: "e-mail", preferred: "email" }],
  waivers: new Set(),
  labelMaxWords: 4,
};
const rules = (key, value, cfg = config) => checkValue(key, value, cfg).map((f) => f.rule);

test("copy-check: DENIES the bad cases", () => {
  // The acceptance example: "Submit Request." trips BOTH trailing-period and sentence-case.
  const submit = rules("x.submit", "Submit Request.");
  assert.ok(submit.includes("trailing-period"), "trailing period on a label must fail");
  assert.ok(submit.includes("sentence-case"), '"Request" (Title Case) must fail');

  // Title Case labels.
  assert.deepEqual(rules("x.back", "Back Home"), ["sentence-case"]);
  assert.deepEqual(rules("x.pw", "Change Password"), ["sentence-case"]);

  // A lone trailing period on a short label (no interior capital).
  assert.deepEqual(rules("x.done", "All done."), ["trailing-period"]);

  // Banned terminology (case-insensitive, any length).
  assert.deepEqual(rules("x.mail", "Reset your e-mail address"), ["terminology"]);
});

test("copy-check: ALLOWS the good cases", () => {
  assert.deepEqual(rules("x.save", "Save"), []);
  assert.deepEqual(rules("x.back", "Back home"), []); // sentence case
  assert.deepEqual(rules("x.search", "Search..."), []); // ellipsis, not a period
  assert.deepEqual(rules("x.search2", "Search…"), []); // unicode ellipsis
  assert.deepEqual(rules("x.q", "Restore this item?"), []); // question mark ok
  assert.deepEqual(rules("x.id", "Entity ID"), []); // ALL-CAPS acronym, not Title Case
  assert.deepEqual(rules("x.ms", "Sign in with Microsoft"), []); // proper noun allowlisted
  assert.deepEqual(rules("x.sel", "{count} selected"), []); // placeholder + lowercase
  // A real sentence (> labelMaxWords) may end in a period and carry proper nouns.
  assert.deepEqual(rules("x.err", "An unexpected error occurred. Please try again."), []);
});

test("copy-check: a waiver exempts a key from all checks", () => {
  const waived = { ...config, waivers: new Set(["x.legacy"]) };
  assert.deepEqual(rules("x.legacy", "Legacy Title Case.", waived), []);
  // …but only the waived key; a sibling still fails.
  assert.ok(rules("x.other", "Other Label", waived).includes("sentence-case"));
});

test("copy-check: flatten walks nested namespaces to dot-paths", () => {
  const flat = flattenMessages({ a: { b: "one", c: { d: "two" } }, e: "three", n: 5 });
  assert.deepEqual(flat, [
    { key: "a.b", value: "one" },
    { key: "a.c.d", value: "two" },
    { key: "e", value: "three" },
  ]);
});

test("copy-check: checkMessages aggregates findings across a tree", () => {
  const findings = checkMessages(
    { nav: { auditLog: "Audit Log" }, common: { save: "Save" } },
    config,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, "nav.auditLog");
  assert.equal(findings[0].rule, "sentence-case");
});

test("copy-check: loadConfig merges defaults with a fork's copy block", () => {
  // Defaults are present even with no config file present on disk at this path.
  const cfg = loadConfig("does-not-exist.json");
  assert.ok(cfg.properNouns.has("Microsoft"));
  assert.equal(cfg.labelMaxWords, 4);
  assert.ok(Array.isArray(cfg.terminology));
  assert.ok(cfg.locales.length >= 1);
});
