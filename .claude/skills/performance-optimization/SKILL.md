---
name: performance-optimization
description: Diagnoses real performance problems -- it's slow, page load, Core Web Vitals below target, N+1 or unbounded query, "why is this query slow", bundle size growth. Measures with this repo's tools (Lighthouse CI, size-limit, timed queries) before and after any fix. Not a substitute for /stack-advisor's build-time query shapes.
---

# Performance Optimization

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`performance-optimization`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

Measure before optimizing. Performance work without a number is guessing, and guessing adds
complexity without improving anything real. This repo already gates two of the Five Pillars
mechanically — **Speed & Velocity** and **Scalable** (`docs/uat-rubric.md`) — and `npm run ship`
already fails an `app/api/**/route.ts` with an unbounded `findMany()`. That gate is the floor;
`/stack-advisor` teaches the bounded/index-aware query SHAPE while you write the route in the
first place. This skill is what happens **after**: something is measurably slow in code that
already passed those gates, and you need to find the actual bottleneck and prove the fix worked.

## When to use

- Someone reports "it's slow" — a page, a route, a specific interaction
- Lighthouse (`lighthouserc.cjs`) or the `size-limit` budget (`.size-limit.json`) is failing or trending the wrong way
- You suspect an N+1 or an unbounded read that the `/ship` scalability scan didn't catch (e.g. it's inside a service function, not directly in the route file the scan greps)
- A migration or feature added a query and you want to know its actual cost, not a guess

**When NOT to use:** don't optimize a path nobody hits. A slow admin export route nobody has run
in production yet, or a component that renders twice a session, is not worth a profiling pass —
that's premature optimization, and the complexity it adds outlasts the problem it solved. If
there's no user-facing symptom and no gate failing, there's nothing to measure yet.

## Steps

1. **Reproduce and measure a baseline, with this repo's tools — not a new one.**
   - Frontend / Core Web Vitals: `LHCI_URL=<preview-url> npm run lhci` (wraps `lighthouserc.cjs`,
     3 runs, asserts `categories:performance` ≥ 0.9). No preview yet: `npm run lhci` alone falls
     back to a local `next start` on `:3000`.
   - Bundle size: `npx size-limit` against `.size-limit.json` (client JS chunks, gzip). This also
     runs inside `npm run ship -- --full` — check whether it's already red before hand-measuring.
   - Backend / query: wrap the suspect Prisma call and log wall-clock, or check the query in
     Postgres directly (`EXPLAIN ANALYZE`) if you suspect a missing index. Don't reach for a new
     APM dependency for a one-off measurement — `console.time`/`console.timeEnd` around the call is
     enough to identify the bottleneck; installing anything that logs response bodies risks
     `no-secret-env-in-console`-adjacent leakage, so log timings and shapes, never payloads.
   - Note the exact command, URL/route, and conditions (cold vs warm cache, page/pageSize) — the
     "after" measurement must repeat them exactly, or the delta is meaningless.

2. **Find the actual bottleneck, don't assume it.** Common shapes in this stack:
   - **N+1 outside the route file.** The `/ship` scan only greps `app/api/**/route.ts`; a loop of
     per-row `findUnique` calls hidden in a service function or a server component's data helper
     won't trip it. Same fix either way: pull the relation with `include`/nested `select` in one
     query (`/stack-advisor` Layer 2 has the reference shape — `app/api/users/route.ts`).
   - **Unbounded read that isn't a plain `findMany()`.** A `count()` over an unfiltered table, a
     `groupBy` with no `where`, or a client-side `.slice()` after fetching everything all bypass
     the static scan's pattern-match but cost the same. Push the bound into the query (`take`/
     `skip`/`cursor`) per `lib/pagination.ts`, not into JS.
   - **Missing index.** Filtering/sorting/joining on an un-indexed column costs more as rows grow.
     Adding an `@@index` is a schema/migration change — Ask-before per CLAUDE.md; surface it, keep
     the migration small and forward-compatible (`vercel.json` runs `migrate deploy` every build).
   - **Client fetch where an RSC read would do.** A `useEffect` fetch on first paint round-trips
     through the browser for data the server already had at request time — the fix is the RSC
     read `/stack-advisor` Layer 1 describes, not a faster client fetch.
   - **Bundle growth.** Before reaching for a lazy `import()` or a lighter library, check
     `size-limit`'s report for which chunk grew and why (`npx size-limit --why` if available)
     rather than guessing which import is heavy.

3. **Fix the one bottleneck you found — nothing else in the same change.** If a genuinely
   unbounded read must stay unbounded (a small, domain-bounded lookup table), that's a
   `// pillar:scalable-ok: <reason>` inline note plus a `docs/findings-register.md` line — a
   logged wave-off, never a silent skip. Never trade the security floor for speed: no dropped
   `select` allowlist, no `withRateLimit` removed, no `session` cast to `any`, no new runtime dep
   without surfacing the Ask-before (>50 KB minified) gate first — an optimization that pulls in a
   library is a decision to surface, not a decision to make quietly.

4. **Re-measure the same way.** Same command, same URL/route, same cache state, same
   page/pageSize. Repeat once if the result is close, and compare the delta against run-to-run
   noise, not just the two headline numbers.

5. **Keep or revert, strictly:**

   | Result vs. baseline | Action |
   |---|---|
   | Past the threshold, `/ship` still green | **Keep.** Put the before/after numbers in the commit message. |
   | Within noise (no measurable change) | **Revert.** |
   | Worse | **Revert.** |
   | Improved, but a test or `/ship` gate went red | **Revert.** A regression wearing a win's clothing. |

   "Didn't help much, but it doesn't hurt" is a revert, not a keep — code you keep, you maintain
   forever, and an unmeasured neutral change is exactly how the codebase accretes complexity that
   never paid for itself.

6. **Log the attempt, kept or reverted.** A short note (commit message, PR description, or a
   `docs/findings-register.md` line if it was a pillar wave-off) naming the idea, the before→after
   numbers, and the verdict — so a dead idea isn't re-tried next quarter by someone who didn't see
   it fail the first time.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is obviously the slow part" | If you didn't measure it, you don't know. `/ship`'s scan and `/stack-advisor`'s shapes catch the obvious cases already — what's left needs a profile, not a hunch. |
| "The `/ship` scalability scan already checked this" | It greps `findMany(` in route files only. A service-layer loop, a `count()`/`groupBy` without a `where`, or a client-side slice all pass it silently. |
| "We'll optimize later" | Fine for genuine premature optimization (step 0's "when not to"). Not fine once there's a real symptom or a failing gate — that's not later, that's now. |
| "It didn't help much, but it doesn't hurt to keep it" | Neutral is a revert. Maintenance cost forever, zero payback. |
| "Small dependency, I'll just add it" | Anything >50 KB minified is Ask-before in CLAUDE.md regardless of how small the perf win looks — surface it. |
| "The improvement is obvious, no need to re-measure" | Then re-measuring is cheap and proves it. An unmeasured "obvious win" is how a regression ships as a fix. |
| "Three fixes landed together, the number moved, good enough" | One number, three changes — you can't attribute it, and can't safely revert just the one that didn't pay off. |

## Red Flags

- A fix proposed with no baseline number attached
- "Unbounded" reads that dodge the `/ship` grep by living outside `app/api/**/route.ts`, or by being a `count()`/`groupBy`/client-side slice instead of a bare `findMany()`
- A new `@@index` or schema change slipped in without surfacing it as Ask-before
- A new runtime dependency added to shave bundle size without an ADR / `/scale-up` recipe
- `size-limit` or `lhci` failing and the fix is to raise the budget instead of shrink the payload
- A kept change with no re-measurement, or one measured under different conditions than the baseline
- Several optimizations bundled into one commit with one combined "it's faster now" claim

## Verification

- [ ] A BEFORE measurement exists, taken with `npm run lhci`, `npx size-limit`, or a timed query — not a guess
- [ ] The actual bottleneck was identified (route/query/component named), not assumed
- [ ] The fix does not touch the security floor: auth wrapper intact, zod validation intact, no `select`/`SELECT *` widened, no `session as any`
- [ ] Any new runtime dep >50 KB or schema/index change was surfaced as Ask-before, not landed quietly
- [ ] An AFTER measurement exists, from the *same* method/command/conditions as the BEFORE
- [ ] The delta is justified against run-to-run noise, not just a single before/after pair
- [ ] `npm run ship` is still green (or `npm run ship -- --full` if `size-limit`/Docker phases are relevant)
- [ ] A neutral or worse result was reverted, not kept
- [ ] The attempt (kept or reverted) is logged somewhere the next session will see before retrying it

## Related

- `.claude/skills/stack-advisor/SKILL.md` — the bounded/index-aware query SHAPE, used *while writing* the route; this skill is measure-then-fix *after*.
- `.claude/skills/ship/SKILL.md` — step 4b (scalability scan), step 8 (`size-limit` in `--full`); the gate this skill's fixes must stay green against.
- `docs/rules/prisma.md` — no `SELECT *`, no N+1, bulk paths not N×1.
- `lighthouserc.cjs`, `.size-limit.json` — the measurement configs this skill runs against, not replaces.
- `docs/uat-rubric.md` — Pillar 1 (Speed & Velocity) and Pillar 4 (Scalable) definitions.
- `docs/findings-register.md` — where a genuine, reasoned wave-off gets logged instead of silently skipped.
