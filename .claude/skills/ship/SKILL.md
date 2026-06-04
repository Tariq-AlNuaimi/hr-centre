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

Run the seven checks below **in order**, cheapest-to-most-expensive. **Stop on the
first failure** — do not run later steps, do not commit, do not push.

> Companion: for any push that touches auth, schemas, API routes, or anything under
> `lib/`, run the native **`/code-review`** (fresh-context diff review) and resolve
> its findings before `/ship`.

## Steps (in order)

1. **Typecheck.** `npx tsc --noEmit`. Catches schema-vs-code drift after Prisma generate and Auth.js callback fallout.
2. **Lint.** `npm run lint`. Surfaces unused imports, hooks-rules violations, missing keys, accessibility regressions, and the four local `rihal-template/*` security rules.
3. **Tests (contract suite).** `npm test`. Runs the `node:test` contract suite (rate limit, audit scrub, email, export, sentry scrub, auth wrappers) — the highest-risk invariants.
4. **Tests (component suite).** `npm run test:components`. Runs the jsdom React component tests (`tests/components/*.test.tsx`) — DataTable, EmptyState, DashboardError. Catches shared-UI regressions tsc/lint miss.
5. **Build.** `npm run build`. Catches Next.js-specific issues that tsc and ESLint miss: server/client boundary violations, missing `"use client"`, invalid metadata exports, server-only imports leaking to the client bundle.
6. **Secret scan (gitleaks).** `gitleaks detect --no-banner --redact` (the repo ships `.gitleaks.toml`; gitleaks picks it up automatically). Scans the full git history for committed secrets.
   - **If `gitleaks` is not on PATH, do NOT silently skip.** Stop and tell the operator how to install it, then treat ship as **not green** until it can run:
     - macOS: `brew install gitleaks`
     - Linux / other: download the binary from https://github.com/gitleaks/gitleaks/releases and put it on PATH
   - A planted test secret in a tracked file MUST make this step fail.
7. **Dependency audit.** `npm audit --audit-level=high --omit=dev`. Surfaces High+ CVEs in production dependencies locally (this is the check `verify.yml` runs in CI). Record any accepted/remediated CVE in `SECURITY.md` §13.

## On failure
- Report the failing step, the `file:line`, and the first 20 lines of error output.
- Do NOT run the next step. Do NOT push. Do NOT commit.
- Suggest the targeted fix; confirm with the user before re-running.

## On success
- Print: `ship: green -- typecheck + lint + tests + component tests + build + gitleaks + npm audit all pass`.
- If there are staged or unstaged changes, offer to commit + push. Do not auto-push unless the user already asked for it in this session.

## Skip when
- You only touched docs, files under `.claude/`, or `messages/*.json` -- none of those affect the build. Run `npm run lint` + `gitleaks detect` (steps 2 and 5) instead; docs can still leak a secret.
- You only touched `prisma/schema.prisma` -- run `npm run prisma:generate` first, then the full ship sequence (typecheck will catch the rest).

> Local note: this repo's `.env` (copied from `.env.example` by the SessionStart hook)
> sets `NODE_ENV=development`, and Prisma 7 config does not auto-load `.env`. If a step
> can't resolve `DATABASE_URL`, load the env first: `set -a; . ./.env; set +a`. For
> step 4 also `export NODE_ENV=production`, or prerendering fails locally. Neither
> applies on Vercel (`.env` is gitignored; the platform sets `NODE_ENV=production`).
