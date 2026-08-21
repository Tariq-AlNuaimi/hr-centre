// Gate for the red-team guard probe (review round 8).
//
// `guard-probe.mjs` existed since the red-team pass but NOTHING ever ran it:
// `test:hooks` globs `tests/harness/*.test.mjs`, so a suite named `*.mjs` was a
// document, not a gate -- exactly the failure mode the probe was written to catch
// in the hooks themselves. This wrapper puts it on the same rail as the other
// harness tests; the CLI (`node tests/harness/guard-probe.mjs`) still works and
// still prints the full per-case table.
import test from "node:test";
import assert from "node:assert/strict";
import { DESTRUCTIVE, SECRETS, LEGITIMATE, bash, secret } from "./guard-probe.mjs";

// Each hook spawns a node process per case; the full matrix is ~90 spawns.
const TIMEOUT = 120_000;

test("destructive commands are denied", { timeout: TIMEOUT }, () => {
  const gaps = DESTRUCTIVE.filter(([, cmd]) => !bash(cmd)).map(([label]) => label);
  assert.deepEqual(gaps, [], `dangerous-commands.mjs ALLOWED: ${gaps.join(", ")}`);
});

test("secret reads and exfiltration are denied", { timeout: TIMEOUT }, () => {
  const gaps = SECRETS.filter(([, cmd]) => !secret(cmd)).map(([label]) => label);
  assert.deepEqual(gaps, [], `protect-secrets.mjs ALLOWED: ${gaps.join(", ")}`);
});

// Both guards fail CLOSED, so a false positive blocks real work until someone edits
// the hook -- and teaches the operator to wave gates through. This half of the probe
// is load-bearing, not a courtesy.
test("ordinary work is not blocked", { timeout: TIMEOUT }, () => {
  const fps = LEGITIMATE.filter(([, cmd, fn]) => fn(cmd)).map(([label]) => label);
  assert.deepEqual(fps, [], `guards DENIED legitimate work: ${fps.join(", ")}`);
});
