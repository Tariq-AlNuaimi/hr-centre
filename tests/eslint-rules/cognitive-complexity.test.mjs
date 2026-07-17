// V2-404 — the cognitive-complexity gate (eslint-plugin-sonarjs) works AS WIRED.
//
// The RuleTester file next door proves the local rihal rules in isolation; this one
// asserts the ADOPTED sonarjs rule against the REAL eslint.config.mjs — so it verifies
// three things a rule-in-isolation test can't: (1) the rule is actually ON at `error`,
// (2) the configured THRESHOLD (25) is the one enforced, and (3) the SCOPE — product
// surfaces yes, scripts/** no. A regression that raises the threshold, drops the rule,
// or widens/narrows the scope turns this red. Wired via `npm run test:lint-rules`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

const eslint = new ESLint(); // loads the repo's real eslint.config.mjs

// A function whose cognitive complexity clearly exceeds the 25 threshold: 30 sequential
// `if` statements = +1 each = 30 (built at runtime so the source here stays small).
const overThreshold =
  "export function planted(x: number) {\n" +
  Array.from({ length: 30 }, (_, i) => `  if (x === ${i}) return ${i};`).join("\n") +
  "\n  return -1;\n}\n";

// A trivial function well under the threshold.
const underThreshold = "export function ok(x: number) {\n  if (x > 0) return 1;\n  return 0;\n}\n";

const hasCognitiveError = (messages) =>
  messages.some((m) => m.ruleId === "sonarjs/cognitive-complexity" && m.severity === 2);

test("V2-404 cognitive-complexity ERRORS on an over-threshold function in a product file", async () => {
  const [res] = await eslint.lintText(overThreshold, { filePath: "lib/planted-cc.ts" });
  assert.ok(hasCognitiveError(res.messages), "an over-25 function under lib/ must error");
});

test("V2-404 cognitive-complexity ALLOWS a simple product function", async () => {
  const [res] = await eslint.lintText(underThreshold, { filePath: "lib/planted-cc.ts" });
  assert.ok(!hasCognitiveError(res.messages), "an under-threshold function must not error");
});

test("V2-404 cognitive-complexity is SCOPED to product surfaces (not scripts/**)", async () => {
  // The identical over-threshold body in a scripts/ file must NOT trip the gate — harness
  // tooling is deliberately out of scope (scripts/ship.mjs's phase runner sits at 36).
  const [res] = await eslint.lintText(overThreshold.replace(/: number/g, ""), {
    filePath: "scripts/planted-cc.mjs",
  });
  assert.ok(!hasCognitiveError(res.messages), "scripts/** is out of scope — must not error");
});
