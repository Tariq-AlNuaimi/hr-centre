---
name: test-driven-development
description: Drives new behavior and bug fixes with a failing test first, using this repo's node:test runner and test tree. Use when implementing any logic in lib/** or app/api/**, fixing a bug, or changing existing behavior -- never as a substitute for /cover, which only back-fills the coverage floor on code that already works.
---

# Test-Driven Development

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`test-driven-development`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

Write a failing test before writing the code that makes it pass. For a bug fix, reproduce the bug with a test before touching the fix. "Seems right" is not evidence — a red-then-green test is. This repo's test runner is **`node:test`** (via `tsx`), not Jest: no `describe`/`expect`/`jest.fn`, just `import { test } from "node:test"` and `import assert from "node:assert/strict"`. Tests live under `tests/`, split by what they exercise (see Steps). The suite feeds `npm run ship`'s test step and its `lib/**` coverage floor directly — a behavior with no test is invisible to both.

## When to use

- Implementing any new logic under `lib/**` or a new `app/api/**/route.ts` handler
- Fixing a bug — reproduce it with a failing test before attempting the fix
- Changing existing behavior in a way that could regress a caller
- Adding a Restricted field, an auth check, or anything the security floor touches (13 ESLint rules at `error`, the `lib/api-helpers.ts` wrappers, zod boundary validation in `lib/validations/`) — these get a **contract test**, never just a lint pass
- Adding edge-case handling (bounds, empty input, malformed payloads)

**When NOT to use:**

- Pure docs, `messages/*.json` copy, or config changes with no behavioral surface
- Closing a coverage gap on code that already works correctly and already has behavioral tests — that's `/cover`'s job, not this skill's (see the tension below)
- Exploratory prototyping before a `/blueprint` exists — pin the contract first, then TDD the implementation against it

**TDD vs `/cover` — they are not interchangeable.** TDD is the discipline for *new* behavior and bug fixes: the test is written first, it fails for the right reason, then the implementation is written to satisfy it. `/cover` runs *after* the fact, generating tests only to push an already-working file's `lib/**` coverage (lines 75 / functions 78 / branches 88) over the `/ship` floor, keeping only tests that pass AND raise the number. Writing a feature TDD-first and then also needing `/cover` is a smell, not a plan — TDD tests that actually exercise the new code should already clear the floor for it. Reach for `/cover` only on pre-existing gaps the diff didn't create.

## Steps

1. **Find where this behavior's tests live.** Don't guess a location — match the existing tree:
   - `tests/contracts/*.test.ts` — security/business invariants scored by the `lib/**` coverage floor (auth wrappers, rate limit, audit scrub, email, license gate). New logic under `lib/**` that the floor should count belongs here.
   - `tests/property/*.test.ts` — pure functions over a wide input space, via `fast-check` (bounds, parsing, pagination-style math).
   - `tests/components/*.test.tsx` — shared React components, jsdom + `@testing-library/react` (`npm run test:components`). Not scored by the `lib/**` floor — write these for correctness, not coverage.
   - `tests/integration/*.test.ts` — cross-cutting flows (soft-delete + audit, pgvector) needing more than one collaborator.
   - Unsure where a new area's tests belong? Check `docs/REPO-MAP.md` before inventing a new test directory.
2. **RED — write the test first, confirm it fails for the right reason.** Import the unit under test by relative path; assert on real return values or thrown errors, not on which internal calls fired. Run it (`npm test`, or `npm run test:components` for a component) and read the failure — it must fail because the behavior doesn't exist yet, not because of a typo in the test itself.
3. **GREEN — write the minimum code to pass.** No gold-plating past what the test demands. Route it correctly for this stack: UI calls an API route, the route calls a service, only the service/route touches `prisma` (`no-prisma-in-client`); every route composes a `lib/api-helpers.ts` wrapper (`withAuth`/`withAdminAuth`/`withEditorAuth`/`withInternalAuth`, `withRateLimit` outside them) and validates its boundary with a `lib/validations/` zod schema. A test that only passes because a wrapper or validation was skipped is not green — it's a false GREEN.
4. **REFACTOR — clean up with tests green.** Extract, rename, de-duplicate. Re-run the same test file after each step; nothing here loosens the security floor rules above, they apply to refactored code exactly as they did to the first draft.
5. **Prove-It Pattern for bug fixes.** On a bug report: write a test that reproduces it, confirm it fails, then fix. The regression test stays in the suite as the permanent guard.
6. **Run the full relevant suite before calling it done.** `npm test` for the contract + property suites (this is also what `npm run ship` step 3 runs); `npm run test:components` for component changes. Don't stop at the one file you touched — a shared primitive change can break a sibling test.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll just run /cover after to get coverage up." | `/cover` back-fills a floor on working code; it does not verify NEW behavior is correct. A test written after the fact to raise a number proves the number moved, not that the code is right. Write the RED test first for anything this diff introduces. |
| "This is too simple to test." | Simple code gets complicated, and a route with no auth wrapper or zod schema is a security-floor gap, not a simplicity win — the thirteen ESLint rules will not catch missing behavioral coverage. |
| "I tested it manually in the browser." | Manual checks don't persist past the session; the next `npm run ship` run has no record of it. A test does. |
| "It's just a /quickstart prototype." | Project tier scales ceremony, never the security floor (CLAUDE.md "Project tiers") — a Restricted-data route or an auth wrapper still needs its contract test regardless of tier. |
| "The coverage floor is already green, so I'm done." | Green coverage on an untouched baseline says nothing about the behavior you just added — coverage is a floor `/cover` maintains, not proof your new logic is correct. |
| "I'll write the test and the code together, it's basically the same thing." | If the test is written after the implementation exists, it tends to test what the code does, not what it should do — the RED step is what proves the test can actually fail. |

## Red Flags

- New logic in `lib/**` or a new `app/api/**/route.ts` handler with no corresponding `tests/contracts/` test
- Reaching for `/cover` on code this diff just introduced, instead of writing it TDD-first
- A test that passed on its first run without ever failing first
- A bug fix with no reproduction test
- A route test that passes because an auth wrapper, rate limit, or zod validation was stubbed out to make it pass
- Running `npm test` and reporting green without having actually run it this session
- Test names that don't describe the behavior (`it("works")`, `it("handles it")`)

## Verification

This skill emits no artifact of its own — it feeds `npm run ship`'s test step (3) and `lib/**` coverage floor (4b) directly; a clean `/ship` run is the receipt.

- [ ] Every new behavior in this diff has a corresponding test in the matching `tests/` subtree
- [ ] Each new test was seen to fail before the implementation existed (RED confirmed, not assumed)
- [ ] Bug fixes carry a reproduction test that failed pre-fix
- [ ] `npm test` passes (and `npm run test:components` for component changes) — run fresh, not recalled from an earlier turn
- [ ] No route in the diff skips its `lib/api-helpers.ts` wrapper or its `lib/validations/` zod schema to make a test pass
- [ ] No test was skipped, `.only`'d, or silently dropped to get to green
