---
name: ship
description: Pre-commit verification -- typecheck + lint + tests + production build + secret scan + dependency audit. The active security gate for a solo operator on the free plan (replaces CI / branch protection, runs on any machine). Stops on the first failure with the file:line so the next edit is targeted. Trigger phrases: "ship", "verify", "is this green", "ready to push", "/ship".
---

# Ship

`/ship` is the **active enforcement gate** for this repo. On the current plan (solo
operator, free GitHub plan with Actions billing blocked) the CI workflows do **not**
run, so the checks they would perform are mirrored here and run locally, on any
machine, before every push. CI re-activates at `/handoff` when the IT team's paid
plan can run Actions.

**Preferred execution: `npm run ship`** (`scripts/ship.mjs`). It runs the same seven
checks with steps 1-4 in parallel, tsc/eslint caches under `node_modules/.cache`
(cold on fresh clones and CI, warm within a session), auto-heals the stale-`.next/types`
trap, and stops the line on any failure with the `file:line`. Measured: **~45s warm /
~100s cold** vs ~4-6 min sequential. Failure semantics are identical to running the
steps by hand.

Fallback: run the seven checks below **in order**, cheapest-to-most-expensive. **Stop
on the first failure** — do not run later steps, do not commit, do not push.

**Parallelization (when running by hand):** steps 1-4 are independent
of each other — they may run **concurrently** (e.g. as parallel tool calls or
backgrounded shells), as long as ALL four are green before step 5 (build) starts
and a failure in any of them is reported with the same stop-the-line semantics.
Steps 5-7 stay sequential. When in doubt, run sequentially — correctness of the
gate beats speed.

> Companion: for any push that touches auth, schemas, API routes, or anything under
> `lib/`, run the native **`/code-review`** (fresh-context diff review) and resolve
> its findings before `/ship`.
>
> Companion (post-push): `/ship` gates **code correctness** (does the diff typecheck,
> lint, test, build, and pass the secret/dep scans). It does **not** see cross-cutting
> invariants — audit completeness, output-side trust boundaries, operational drift,
> architecture. Those are the ADR-020 **`senior-code-reviewer`** breadth pass that
> runs after the push (CI `senior-review.yml`, or invoke the agent when CI is off).
> A green `/ship` alone is **not** sufficient before calling work done.

## Steps (in order)

1. **Typecheck.** `npx tsc --noEmit`. Catches schema-vs-code drift after Prisma generate and Auth.js callback fallout.
   - **Stale-cache trap:** `tsconfig.json` includes `.next/types`, which is generated
     by the *last* build. After large deletions/renames of routes or pages, typecheck
     can fail with `TS2307: Cannot find module '../../app/...'` errors pointing into
     `.next/types/` — that's the stale build cache, not your code. Fix: delete the
     `.next` directory and re-run (step 5 regenerates it).
2. **Lint.** `npm run lint`. Surfaces unused imports, hooks-rules violations, missing keys, accessibility regressions, and the ten local `rihal-template/*` security rules.
3. **Tests (contract suite).** `npm test`. Runs the `node:test` contract suite (rate limit, audit scrub, email, export, sentry scrub, auth wrappers) — the highest-risk invariants.
4. **Tests (component suite).** `npm run test:components`. Runs the jsdom React component tests (`tests/components/*.test.tsx`) — DataTable, EmptyState, DashboardError. Catches shared-UI regressions tsc/lint miss.
4b. **Scalability gate (Five Pillars).** A static scan (in `scripts/ship.mjs`, runs with phase A) fails the build on an **unbounded `findMany`** in any `app/api/**/route.ts` — a `findMany(` in a file with no `take`/`skip`/`cursor`/`parsePagination`. That pattern loads the whole table and only hurts at volume. Fix with `lib/pagination.ts` (`parsePagination`/`paginatedResponse`); or, for a table bounded by domain, add an inline `// pillar:scalable-ok: <reason>` AND a `docs/findings-register.md` line (a logged wave-off, never silent).
4c. **Wave-off gate (Five Pillars).** A static scan fails the build on any **`status: open` wave-off** in `docs/findings-register.md`. A wave-off is a pillar concern someone chose not to fix; it must be *adjudicated* (operator accepts/schedules it → `status: adjudicated(<date>)`) or *fixed* (`status: fixed(<commit>)`) before green. This makes "acceptable" a recorded, reviewed decision (complaint #12) rather than a silent shrug. An un-adjudicated open finding blocks the same as a failing test.
4d. **Tier gate (Project tiers).** A static scan fails the build when `project.config.json` tier is still the `personal` default but the repo has **≥2 distinct human contributors** (bots — Claude's noreply, dependabot, `*[bot]` — don't count). A multi-contributor tool is *shared* and shouldn't silently skip the shared-tier ceremony (`/handoff`, SECURITY.md §9 compliance, formal findings register, CI activation). Fix by setting `"tier": "shared"`, or record an intentional exception with `"tierAck": "personal"`.
4e. **Blueprint gate (`/blueprint` full track).** A static scan detects a **new feature surface** in the diff vs the `origin/main` merge-base — a newly-*added* `app/api/**/route.ts` file or a new `prisma/migrations/` directory (edits to existing files never trip it, so bug fixes / refactors / dependency bumps are unaffected). A real feature should ship its contract, so the gate requires a committed `docs/blueprints/<feature>.md` in the same change. **Tiered:** `shared` projects **block**; `personal` projects only **warn** (keeps the disposable `/quickstart` idea-to-URL flow unblocked). Escape hatches: add the blueprint file, or set `"blueprintAck": "<reason>"` in `project.config.json`.
4f. **DB-structure gate (ADR-031).** A scan (in `scripts/ship.mjs`, runs with phase A) enforces a structured, migrated Postgres schema: (a) `prisma/schema.prisma` has **≥1 domain model** beyond the auth/audit baseline (`User`/`Account`/`Session`/`VerificationToken`/`AuditLog`) — the pristine template (pre-`/rebrand` package name) is exempt, every fork is gated; (b) `prisma/migrations/` is **non-empty**; (c) migrations are **in sync** with the schema (`prisma migrate diff --from-migrations --to-schema`, which needs `SHADOW_DATABASE_URL` pointing at a disposable EMPTY Postgres DB — when unset/unreachable this sub-check degrades to a **WARN**, never a false red; a real drift when it CAN run fails red). Escape hatch for a rare genuinely stateless fork, never silent: `"dbAck": "<reason>"` in `project.config.json` **plus** an adjudicated ADR-031/dbAck line in `docs/findings-register.md`.
5. **Build.** `npm run build`. Catches Next.js-specific issues that tsc and ESLint miss: server/client boundary violations, missing `"use client"`, invalid metadata exports, server-only imports leaking to the client bundle.
   - **Local env/NODE_ENV.** This repo's `.env` (copied from `.env.example` by the SessionStart hook) sets `NODE_ENV=development`, and Prisma 7 config does not auto-load `.env`. The production build phase needs `NODE_ENV=production` — locally, `export NODE_ENV=production` for this step or prerendering fails. If any step can't resolve `DATABASE_URL`, load the env first: `set -a; . ./.env; set +a`. Neither applies on Vercel (`.env` is gitignored; the platform builds with `NODE_ENV=production`).
6. **Secret scan (gitleaks).** `gitleaks detect --no-banner --redact` (the repo ships `.gitleaks.toml`; gitleaks picks it up automatically). Scans the full git history for committed secrets.
   - **If `gitleaks` is not on PATH, do NOT silently skip.** Stop and tell the operator how to install it, then treat ship as **not green** until it can run:
     - macOS: `brew install gitleaks`
     - Linux / other: download the binary from https://github.com/gitleaks/gitleaks/releases and put it on PATH
   - A planted test secret in a tracked file MUST make this step fail.
7. **Dependency audit.** `npm audit --audit-level=high --omit=dev`. Surfaces High+ CVEs in production dependencies locally — the same threshold `verify.yml` runs in CI (both at `high`).
   - **CVE-acceptance flow.** A High+ CVE that's upstream-unfixed (or not reachable in this app's usage) can be accepted via `audit-allowlist.json` at the repo root: add the GHSA id to its `advisories` array (`{ "advisories": [{ "id": "GHSA-…" }] }`) and `scripts/ship.mjs` drops it from the offender count so the step passes (it reports `clean (allowlisted: …)`). A High+ advisory NOT in the allowlist still fails. Every entry MUST be justified with a `SECURITY.md` §12/§13 row (advisory, why it's accepted, revisit date) in the same commit — an allowlist entry without that record is an unjustified suppression (see "Ask before"). A malformed file safe-fails to empty (every High+ advisory then fails the gate).

## On failure
- Report the failing step, the `file:line`, and the first 20 lines of error output.
- Do NOT run the next step. Do NOT push. Do NOT commit.
- Suggest the targeted fix; confirm with the user before re-running.

## On success
- Print: `ship: green -- typecheck + lint + tests + component tests + scalability + wave-offs + tier + blueprint + db-structure + build + gitleaks + npm audit all pass`.
- **Affirm the five pillars (blocking checklist — the part no static check covers).** Before declaring done, confirm in one line each that the change honors **Speed · Secure · Maintainable · Scalable · High-Quality** (CLAUDE.md "Five Pillars"). The automated steps cover Secure (ESLint) and Scalable (step 4b); you affirm Speed (no needless round-trips/unbounded payloads), Maintainable (reused existing primitives — checked `docs/REPO-MAP.md`, no dead code), and High-Quality (honest empty/loading/error states, axe-clean) by inspection. A pillar you can't affirm and choose not to fix is a **wave-off** → log it in `docs/findings-register.md`; do not silently pass it.
- If there are staged or unstaged changes, offer to commit + push. Do not auto-push unless the user already asked for it in this session.

## Skip when
- You only touched docs, files under `.claude/`, or `messages/*.json` -- none of those affect the build. Run `npm run lint` + `gitleaks detect` (steps 2 and 5) instead; docs can still leak a secret.
- You only touched `prisma/schema.prisma` -- run `npm run prisma:generate` first, then the full ship sequence (typecheck will catch the rest).

## Do not skip this because…

The "Skip when" list above is the ONLY sanctioned reduction. These are not:

| Rationalization | Rebuttal |
|---|---|
| "It's a docs-only change." | Then you still owe steps 2 + 6 (see Skip when) — a doc can leak a secret, and gitleaks scans history, not intent. "Docs-only" reduces the gate; it never zeroes it. |
| "It's just a prototype / personal tier." | Tier scales *ceremony*, never the security floor (CLAUDE.md "Project tiers"). `/ship` before every push IS the floor — it's the CI this repo doesn't have. |
| "The operator is waiting / said be fast." | `npm run ship` is ~45s warm. A broken push costs a Vercel deploy cycle, a bisect, and the operator's trust — every one slower than 45 seconds. |
| "I only changed one line — it can't break the build." | The stale-`.next/types` trap, a Prisma-generate drift, and a `messages/` key mismatch have each broken builds from one-line diffs. The gate exists because "can't break" is a prediction, not a check. |
| "It was green ten minutes ago and I barely touched it since." | Green describes a commit, not a session. The gate is cached — a truly-unchanged re-run is nearly free, so run it. |
| "gitleaks isn't installed, I'll skip that step just this once." | That's the explicitly-forbidden case in step 6: not-installed = **not green**. Install it or stop; a skipped secret scan is how a Restricted credential lands in permanent history. |
