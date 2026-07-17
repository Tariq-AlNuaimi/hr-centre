---
name: docs-current
description: Pull CURRENT documentation for the locked stack (Next.js 16, Prisma 7, Tailwind v4, Auth.js v5, Playwright, zod, next-intl) before answering a version-sensitive question, so a stale training answer doesn't ship. Routes through the context7 MCP (live, version-pinned library docs) with a WebSearch / docs/recipes.md fallback. Use when the answer depends on an exact API/config that may have changed across versions, when the user asks "what's the current way to X in <stack lib>", before writing code against a fast-moving API, or when unsure whether a remembered API still exists. Trigger phrases: "docs-current", "current docs", "is this still the API", "check the latest docs", "did this change in <version>".
---

# /docs-current — version-correct stack docs before you answer

The stack is LOCKED (ADR-001) at specific majors: **Next.js 16 · Prisma 7 · Tailwind v4 · Auth.js
v5 (next-auth 5.0.0-beta.31, frozen — ADR-056) · Playwright · zod v4 · next-intl v4**. Training data
lags real releases, so a remembered API can be wrong for the pinned version. This skill pulls the
CURRENT docs first, then answers.

Build-vs-buy: `docs/build-vs-buy-ledger.md` (V2-504) — adopts the already-connected **context7 MCP**
(purpose-built, version-pinned library-doc lookup) over a hand-built fetch-and-cache skill.

## When to use it

- The answer hinges on an exact API signature, config key, or option that could differ by version.
- Before writing non-trivial code against Prisma, Next, Tailwind, Auth.js, Playwright, zod, next-intl.
- You're about to answer from memory but aren't sure the API still exists on the pinned major.
- A `/stack-advisor` build question needs the current framework-correct pattern.

Skip it for stable language/general-programming questions, or where `docs/recipes.md` /
`docs/design-recipes.md` already carry a vetted, version-correct pattern for THIS repo.

## Steps

1. **Pin the version.** Read the exact pinned version from `package.json` (e.g. `prisma`, `next`,
   `tailwindcss`, `next-auth`, `@playwright/test`, `zod`, `next-intl`) so the lookup targets what the
   repo actually runs — not "latest".
2. **Resolve the library** — `context7 resolve-library-id` with the official name (e.g. "Prisma",
   "Next.js", "Tailwind CSS"). Pick the high-reputation match and, when offered, the version that
   matches step 1 → a `/org/project/version` id (e.g. `/prisma/prisma/7.6.0`).
3. **Query the docs** — `context7 query-docs` with ONE specific concept per call (e.g. "Prisma
   Client query extension with $extends", not "prisma extensions"). Make a separate call per distinct
   concept.
4. **Answer from what came back**, citing the version, and prefer this repo's shared primitives /
   recipes when they already wrap the API (a fork's convention beats a raw doc snippet).

## Fallback (context7 unreachable / egress blocked)

Never answer from stale memory when the lookup fails. In order:

1. **`docs/recipes.md` + `docs/design-recipes.md`** — the repo's vetted, version-correct patterns.
2. **WebSearch** the OFFICIAL docs site (`nextjs.org`, `prisma.io/docs`, `tailwindcss.com`,
   `authjs.dev`, `playwright.dev`), scoped to the pinned major.
3. If neither is possible, **say so** — "couldn't verify against current docs (context7 + web both
   unreachable); this is from training data and may be stale for `<lib>@<version>`" — rather than
   presenting a possibly-stale answer as current.

## Notes

- The `next-auth` beta is FROZEN (ADR-056) — when answering auth questions, pin `5.0.0-beta.31`, and
  do not recommend upgrading it (a bump is a decision gated by ADR-056's triggers, not a docs answer).
- Quarterly stack-refresh ADRs (ADR-017 track 2) should run this skill on each held major to confirm
  the current API before deciding keep/thin/upgrade (the ADR-TEMPLATE "Platform doctrine sync" hook).
