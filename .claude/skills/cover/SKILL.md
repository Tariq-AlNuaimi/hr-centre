---
name: cover
description: AI test-generation that closes coverage gaps -- writes only tests that pass and raise lib/** coverage, targeting this repo's node:test runner (not Jest). Use when the coverage gate fails, or to generate tests that raise coverage on a file or folder.
---

# /cover — close the coverage gap that fails the `/ship` floor

The A1 coverage floor (`scripts/ship.mjs` `scanCoverage`, ADOPT.md cats 09/16) runs
the contract suite under **node's built-in V8 coverage** — zero extra deps — and
hard-fails `/ship` when `lib/**` drops below **lines 75 / functions 78 / branches 88** (ratcheted V2-403).
The gate exists; the suite behind it is thin. `/cover` is the qodo-cover-style
workflow that fills it — **built as a Claude-driven skill, not a dependency**
(ADR-022 native-over-imported): no qodo-cover install, the discipline lives here.

## The qodo-cover discipline (the one rule that matters)

Generate a candidate test, run it, and **keep it ONLY if it both (a) passes and
(b) raises coverage**. A test that fails, or that passes without moving the
number, is **discarded** — never committed to pad the count. Coverage that goes
up with green tests is the only success signal; a red test or a flat delta means
throw it away and try a different uncovered path.

## Steps

1. **Find the under-covered CHANGED surface.** Scope to what the diff touched —
   `lib/**` files and `app/api/**/route.ts` (the business logic the floor is
   designed to cover). Run the report to see per-file numbers:
   `npm run test:coverage` (report only, no floor) — or the floored form `/ship`
   itself runs:
   `node --experimental-test-coverage --test-coverage-include=lib/** --test-coverage-lines=75 --test-coverage-functions=78 --test-coverage-branches=88 --experimental-test-module-mocks --import tsx --test tests/contracts/*.test.ts`
   Read the per-file rows; target the lowest-covered lib files the change touched,
   not the whole tree.
2. **Pick the right home + runner conventions.** This repo runs **`node --test`**
   with `tsx`, **not Jest** — no `describe`/`expect`/`jest.fn`. Match the shipped shape:
   - `import { test } from "node:test";` + `import assert from "node:assert/strict";`
   - import the unit under test by relative path (`../../lib/...`), assert on real
     return values / thrown errors.
   - **Security-targeted invariants → `tests/contracts/`** (audit scrub, auth
     wrappers, rate limit, export leakage) — these are what the floor's include set
     (`lib/**`) actually scores, so this is where a coverage-raising test belongs.
   - **Pure math / bounds / parsing over ANY input → `tests/property/`** via
     **fast-check** (see `pagination.test.ts`) — property tests hit branches a
     single example misses.
   - **Shared React components → `tests/components/*.test.tsx`** (jsdom +
     `@testing-library/react`, run by `npm run test:components`) — note these are
     NOT in the `lib/**` floor scope, so write them for correctness, not to move
     the coverage number.
3. **Generate → run → keep-or-discard, one file at a time.** Write the smallest
   test that exercises an uncovered line/branch. Run it (`npm test` or the
   coverage command above). Green **and** the number rose → keep. Red or flat →
   discard and pick a different path. Repeat until the touched files clear the floor.
4. **Respect the invariants — don't test-wash them.** A new Restricted field still
   needs its `SCRUB_FIELDS` assertion in `audit-scrub.test.ts` (CLAUDE.md Hard
   rules); a bulk write still needs its audit contract. Coverage is a floor, not a
   substitute for the targeted contract tests the security model relies on.
5. **Re-run `/ship`.** The `scanCoverage` gate is the acceptance check — green
   there is done. Don't hand-tune floors to pass; raise coverage or, if a gap is
   genuinely un-testable, take the logged-waiver path below.

## Notes

- Node **>= 22.13** is required for the `--test-coverage-*` threshold flags; below
  that `scanCoverage` degrades to a WARN and the floor is not enforced — generating
  tests still helps, but you can't rely on the gate to prove it locally.
- **Don't chase 100%.** The floors are set with margin below the real baseline
  (lines ~80.24 / funcs ~83.71 / branch ~93.13); the job is to keep touched files
  above the floor, not to gold-plate coverage on code the change didn't touch.
- A real gap you choose not to close is a **wave-off**, never a silent floor-drop:
  set `"coverageAck": "<reason>"` in `project.config.json` **plus** an adjudicated
  ADR-025/coverageAck line in `docs/findings-register.md`. Lowering the floor
  numbers themselves needs the same justification.

## Skip when

- The diff only touched docs, `.claude/`, or `messages/*.json` — no `lib/**`
  surface, nothing for the floor to score.
- `/ship`'s coverage step is already green on the touched files — don't add tests
  that pass without raising the number (that's exactly what the discipline discards).

## Verification

Before calling this done:

- [ ] Every kept test both passes and raised coverage on the file it targets —
      no test kept that was red or flat
- [ ] The touched `lib/**` files clear the `/ship` floor (lines 75 / functions 78
      / branches 88), via `npm run test:coverage` or `/ship`'s `scanCoverage` step
- [ ] Any new Restricted field still has its `SCRUB_FIELDS` assertion (e.g. in
      `audit-scrub.test.ts`) — coverage didn't substitute for the contract test
- [ ] `npm run ship` is green
- [ ] A genuinely un-testable gap has a logged `coverageAck` + `docs/findings-register.md`
      line, not a silent floor-drop

**Emits:** new passing tests raising `lib/**` coverage toward the `/ship` floor.
