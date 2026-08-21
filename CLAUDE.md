# CLAUDE.md — Fullstack Next.js Template (Constitution)

Rihal internal-tool prototype starter. Stack (ADR-001, locked): Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + Tailwind v4 + shadcn/Radix (ADR-029) + next-intl (RTL) + recharts + zod; Vercel + Neon, `git push` deploys. Owner: Tariq Al-Naaimi. Non-dev stakeholders review via shared URLs; the operator iterates, then `/handoff` gives production to IT (ADR-006). Fork lifecycle: `/rebrand` → `/first-fork` (or `/new-project` / `/deploy`) → `/quickstart` per idea → `/scale-up` per growth axis → `/handoff`.

> **Always-on constitution** (identity, pillars, security floor, Ask-before). Domain detail loads
> lazily by path from `docs/rules/*.md` — read the matching file first (a PreToolUse hook also
> surfaces it on a matching edit): `prisma.md` (`prisma/**`, `lib/prisma/**`)
> · `api-routes.md` (`app/api/**`) · `design.md` (`components/**`, `app/**/*.tsx`) · `deploy.md`
> (`scripts/**`, deploy) · `harness.md` (`.claude/**`, `eslint-rules/**`,
> gates, ESLint roster, commands).

**Read before non-trivial work:** `README.md` · `SECURITY.md` (data classes, secrets, threat model, register) · `docs/decisions/ADR-001` (locked stack) + `ADR-006` (Vercel+Neon) · `prisma/schema.prisma` · `docs/REPO-MAP.md` ("where is X"). Recipes: `docs/recipes.md` + `docs/design-recipes.md`.

## Standing instructions (binding)

- **`main` is the fork source-of-truth.** Land completed green work on `main` before a session ends; merge often. Never land red — `/ship` green is the bar.
- **Pushed-or-it-didn't-happen (#3/#14).** The container is ephemeral; the next session clones **only what was pushed**. Commit completed work and **push before the session ends**, then _verify_ (`git rev-list --count @{u}..HEAD` → `0`), never assume — the `Stop` hook **hard-blocks** turn-end while commits are unpushed. A past session's missing work is usually an unpushed commit — recover, don't claim "no access." (Memory lifecycle in `docs/rules/harness.md`.)
- **Run `/ship` before every push** (`npm run ship`, ~55s warm) — the active gate; CI is dormant on the free plan (triggers + cadence: `docs/rules/harness.md`, ADR-017).
- **Review rail** (two-stage — spec-compliance then quality; detail in `docs/rules/harness.md`): before any push touching auth, schemas, API routes, or `lib/`, run `/code-review` (blocking) and resolve findings; **after** every code push invoke the `senior-code-reviewer` (breadth).
- **Market benchmark before building.** Web-search existing products/libraries first.
- Real multi-file features: **Superpowers** (brainstorm → spec → plan → TDD; opt-in per fork — `.claude/settings.local.json.example`). Disposable idea-to-URL: `/quickstart`.
- **Blueprint before building (pre-build gate).** `/blueprint` first: **lightweight** for `/quickstart`; **full** (committed `docs/blueprints/<feature>.md`: stories + happy/worst scenarios + architecture + open questions) for multi-file or Ask-before work — the contract `/qa`/`/uat` trace against.
- **Auto-plan high blast-radius / ambiguous work.** Call `EnterPlanMode` (await sign-off) when ANY holds: multi-file/multi-step; Ask-before surface; ambiguous requirements; unfamiliar code; hard to reverse. Pair with `/blueprint`. Act directly for read-only lookups, low-risk single-file edits, typos/renames.
- **Ceremony scales with RISK (binding).** Evidence artifacts only for security/data surfaces, Ask-before, migrations, wave-offs; everything else gets a commit message. Always verify; document selectively (`docs/ARCHIVE.md`).
- **Parallel-by-default (binding).** Dispatch ≥2 write-disjoint units of multi-part work as parallel subagents in ONE message, unprompted (file-ownership sets mandatory). Detail in `docs/rules/harness.md`.
- **Deploy/ops** (offer `/deploy` after green ship; a live URL is the default — verify by RUNNING, not assuming): `docs/rules/deploy.md`.

## Five Pillars (binding — gates, not vibes)

Every change is judged against five pillars (full definitions in `docs/uat-rubric.md`) — **gates**: `/ship`/`/qa` enforce them and a violation blocks like a security violation.

1. **Speed & Velocity** — runtime (RSC, bounded payloads) + dev velocity (low context tax, warm `/ship`, parallel-by-default); rubric-gated.
2. **Secure** — auth wrappers + zod on every route; Restricted data gated; audit on; no secret/PII leakage (the thirteen ESLint rules + Hard rules below).
3. **Maintainable** — reuses existing primitives (check `docs/REPO-MAP.md` first); typed; no dead code; forward-compatible migrations.
4. **Scalable** — list/read routes paginate or bound; no N+1; bulk paths not N×1; rate-limit-aware.
5. **High-Quality** — correctness + UX fidelity; honest empty/loading/error states; axe-clean.

`/ship` runs the automatable checks (ESLint security; unbounded-query scalability scan); the non-automatable pillars are a **blocking checklist** `/ship`/`/qa` must affirm (mechanism in Hard rules below).

## Hard rules

- **The Five Pillars are gates, not vibes** (above): unfixed concern → **wave-off in `docs/findings-register.md`**, `/ship` RED until adjudicated. Never silently dropped.
- **The enforcement quartet — process gates, NOT controls:** build-vs-buy (ADR-032), blueprint (ADR-033), complexity (ADR-034), ai-eval (ADR-036/042). Each = a gate + a committed adjudication artifact; a new gated file (`lib/**`, `app/api/**/route.ts`, `app/**/page.tsx`) or over-budget file is **denied/RED** until its ledger/blueprint/ack entry exists (Bash writes too). They fail open; the security floor below is what holds. Mechanism in `docs/rules/harness.md`.
- **Never commit `.env`** (Restricted; SECURITY.md §1; gitleaks gates every push). **Never log** any Restricted env var (`no-secret-env-in-console`; `lib/email.ts` logs metadata only — never `opts.text`/`opts.html`).
- **Go through Prisma.** No raw SQL except `$queryRaw`/`$executeRaw` with placeholders; never `$executeRawUnsafe` on user input; no `SELECT *`; no raw UPDATE/DELETE without WHERE. Audit/soft-delete/SCRUB_FIELDS/naming in `docs/rules/prisma.md`.
- **UI → API route → service → Prisma.** Only server components and API routes touch `prisma` (`no-prisma-in-client`).
- **Use the auth wrappers** (`lib/api-helpers.ts`) on every route; compose `withRateLimit` OUTSIDE them (wrapper table in `docs/rules/api-routes.md`). **Validate at the boundary with zod** (`lib/validations/`); **never cast `session` to `any`** (`no-any-cast-on-session`).
- **Thirteen local ESLint rules, all at `error`** (`eslint-rules/`) are the security floor — roster in `docs/rules/harness.md`. Suppressions: single-line disable; if security-related, log in SECURITY.md §12.
- **UI Definition of Done** (honest empty/loading/error states, on-token, RTL/dark, axe-clean) — build it right first with `/design-system`; rubric in `docs/rules/design.md` + `docs/uat-rubric.md`.

## Project tiers

`project.config.json` `"tier": "personal" | "shared"` (default personal) scales ceremony, **never the security floor** (identical for both). `shared` adds `/handoff`, SECURITY.md §9 compliance, CI at handoff, findings register. **`/ship` enforces tier-vs-reality** (≥2 human contributors on `personal` fails); contract in `docs/rules/harness.md`.

## Ask before

- Installing a runtime dep > 50 KB minified (needs ADR or `/scale-up` recipe)
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `lib/api-helpers.ts`, `middleware.ts`, anything under `lib/prisma/`, `eslint-rules/`, or `prisma/migrations/`
- Adding a model to the audit EXCLUDE set; adding a public path or `/api/internal/*` route; bypassing any auth wrapper; changing the `Role` enum or role checks
- Disabling any `rihal-template/*` rule beyond a single-line disable; suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12); widening `.claude/settings.json` `permissions`
- Pushing to `main` directly when branch protection is on; changing the ADR-001 locked stack (write a superseding ADR first)

When in doubt, stop and ask.
