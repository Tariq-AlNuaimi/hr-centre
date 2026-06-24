# CLAUDE.md — Fullstack Next.js Template (Prototype Rail)

Reusable starter for Rihal internal-tool prototypes. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + Ant Design 6 + next-intl (`en`/`ar`, RTL) + recharts + dnd-kit + zod. Vercel + Neon; deploy = `git push`. Owner: Tariq Al-Naaimi. Audience: non-developer stakeholders reviewing via shared URLs; the operator iterates with Claude, then `/handoff` gives production to the IT team (ADR-006).

Fork lifecycle: `/rebrand` → `/first-fork` (or `/new-project` / `/deploy`) → `/quickstart` per idea → `/scale-up` per growth axis → `/handoff` at the end.

## Read before non-trivial work
- `README.md` — stack overview, project structure
- `SECURITY.md` — data classes, secrets, threat model, findings register
- `docs/decisions/ADR-001` (locked stack) + `ADR-006` (why Vercel+Neon)
- `prisma/schema.prisma` — source of truth for the data model
- `lib/prisma/audit-extension.ts` + `soft-delete-extension.ts` — invariants the codebase relies on
- `docs/recipes.md` — copy-paste examples (email, Excel export, kanban, charts) — load only when needed
- `docs/token-policy.md` — token-thrift rules for sessions (ADR-019)

## Token thrift (binding; full policy: `docs/token-policy.md`, ADR-019)
- Delegate repo-wide searches/investigations to the **scout** agent (haiku, read-only); don't read >5 files inline for orientation. `docs/REPO-MAP.md` answers "where is X" for free.
- Output style: concise; targeted edits over rewrites; no preamble/recap fluff; read a file once unless it changed.
- When compacting, always preserve: the modified-file list, last `/ship` status, open findings, and the operator's goal.
- When the context watchdog warns, run `/handoff-session` at the next milestone; repetitive N-file jobs go through `/batch`, not one long session.
- Durable cross-session knowledge (decisions/gotchas/conventions) lives in `docs/agent-memory.md` (surfaced at SessionStart, bounded ~150 lines) — add via `/remember`; route work by model tier (haiku/sonnet/opus) per the table in `docs/token-policy.md` (ADR-022).

## Harness (`.claude/`)
Skills cover the whole lifecycle — discover them via the skill list; each SKILL.md is self-documenting. Most used: `/quickstart`, `/scaffold-entity`, `/ship`, `/deploy`, `/qa`, `/conform`, `/handoff`. The permission allowlist pre-approves npm/prisma/docker/make/non-destructive git; destructive git ops are deny-listed. The SessionStart hook bootstraps `.env`/deps/client and warns when the branch is behind `origin/main`. Read access to `.next/`, `node_modules/`, `generated/` is denied — work from source + `lib/` types, not build artifacts.

## Standing instructions (binding)
- **`main` is the fork source-of-truth.** Forks are generated from `main` only. Before a session ends, land completed green work on `main`; merge often. Never land red — `/ship` green is the bar.
- **Run `/ship` before every push** (`npm run ship` — parallel + cached, ~45s warm; stops on first failure). It is the active gate; CI workflows are dormant on the free plan and activate at the FIRST of: (a) `/handoff` to a team with Actions, (b) Actions billing unblocking, (c) a second regular contributor. Dependency cadence: ADR-017 (in-range continuously; majors via quarterly stack-refresh ADR).
- **Before any push touching auth, schemas, API routes, or `lib/`**, run the native `/code-review` and resolve findings — the fast, pre-push, diff-scoped gate (blocking).
- **After every push of code, the `senior-code-reviewer` runs** — the async, post-push breadth pass that owns what the diff gate can't see (cross-cutting invariant completeness, adversarial/output-side trust boundaries, operational/time-varying drift, architecture). It layers on top of `/code-review`, never replaces it. Preferred path is CI (`.github/workflows/senior-review.yml`; non-blocking; dormant until `ANTHROPIC_API_KEY` + triggers are set); when CI is off, invoke the `senior-code-reviewer` agent on the change before calling the work done. Portable to any repo/stack via `node scripts/install-senior-review.mjs` (ADR-020; `tools/senior-review/README.md`).
- **After a green `/ship`, if the fork has no Vercel project, offer `/deploy`** (ADR-009; needs `NEON_API_KEY` + `VERCEL_TOKEN` + egress to `api.vercel.com`/`console.neon.tech` — see `.claude/skills/deploy/SKILL.md` for the full env table). If preflight reports blocked egress, surface the hosts; don't mistake it for a missing token.
- **Market benchmark before building.** Any brainstorm/requirements pass starts with a web search of existing products/libraries/starters, summarized with trade-offs before designing. Specs include a short "market scan" section.
- For real multi-file features use Superpowers (plugin: brainstorm → spec → plan → TDD); for disposable idea-to-URL use `/quickstart`. Don't spend spec ceremony on throwaways.
- **Auto-plan high blast-radius / ambiguous work.** Before acting, self-assess and call `EnterPlanMode` (plan first, await sign-off) when ANY holds: the change is multi-file or multi-step; it touches the Ask-before surface (auth, `lib/`, Prisma schema/migrations, API routes, `middleware.ts`, `eslint-rules`); requirements are ambiguous/underspecified; the code is unfamiliar; or the change is hard to reverse. Act directly (no plan) for questions/read-only lookups, single-file low-risk edits, typos/renames, and disposable `/quickstart` work. On a close call, plan — and name the trigger in one line.

## Hard rules
- **Never commit `.env`.** Auth/DB/SMTP credentials are Restricted (SECURITY.md §1). gitleaks gates every push via `/ship`.
- **Never log** any Restricted env var. ESLint `no-secret-env-in-console` catches the obvious form; judgement covers the rest. Email bodies may carry Restricted content — `lib/email.ts` logs metadata only; never log `opts.text`/`opts.html`.
- **Adding a Restricted column?** Extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` AND its assertion in `tests/contracts/audit-scrub.test.ts` in the same commit. Excel exports are a separate gate — audit column lists per route.
- **Go through Prisma.** No raw SQL except `prisma.$queryRaw`/`$executeRaw` with parameter placeholders; never `$executeRawUnsafe` on user input; no `SELECT *`; no raw UPDATE/DELETE without WHERE.
- **UI → API route → service → Prisma.** Only server components and API routes touch `prisma` (`no-prisma-in-client` rule).
- **Use the auth wrappers** (`lib/api-helpers.ts`) on every route: `withAuth` / `withAdminAuth` / `withEditorAuth` (ADMIN|EDITOR) / `withInternalAuth` (shared-secret for schedulers; Vercel-Cron routes opt into `{ bearer: true, skipWhenUnconfigured: true }` — ADR-018) / `withApiAuth` (Bearer for machine consumers, the `/api/v1` seam — ADR-013). Compose `withRateLimit` OUTSIDE the auth wrapper.
- **Audit is automatic but fragile.** `auditExtension` covers every create/update/delete outside the EXCLUDE set; don't extend EXCLUDE without an ADR. Soft-delete is opt-in (`/scaffold-entity` wires it; manual additions must too). `prismaUnfiltered` ≠ `prisma` — auth + recycling-bin only.
- **Validate at the API boundary with zod** (`lib/validations/`). **Never cast `session` to `any`** (`no-any-cast-on-session` rule; `types/index.ts` types `session.user.role`).
- **Naming:** snake_case tables (`@@map`); camelCase Prisma fields/TS; PascalCase React + models + enums.
- Local ESLint plugin (`eslint-rules/`, all at `error`): `no-prisma-in-client`, `no-any-cast-on-session`, `no-secret-env-in-console`, `no-bare-internal-route`, `no-raw-hex-color` (tokens come from `antd-theme.ts` / `app/tokens.css`; ADR-015), `no-unaudited-bulk-write` (Prisma bulk/upsert on an audited model bypasses the audit log; ADR-010), `no-raw-sql-unsafe` (`$queryRawUnsafe`/`$executeRawUnsafe` are unparameterized SQL-injection vectors; OWASP A03), `no-rate-limit-inside-auth` (`withRateLimit` must compose OUTSIDE the auth wrapper so floods are throttled before auth work runs; OWASP A04), `no-restricted-export-column` (a secret-named field as a `toExcel` column key leaks the raw value into the downloadable `.xlsx`; `SCRUB_FIELDS` does not cover exports; SECURITY.md §1), `no-prisma-unfiltered-import` (`prismaUnfiltered` bypasses soft-delete + audit, so it's allowlisted to auth/recycling-bin/maintenance files — an ordinary route importing it is an Ask-before change). Justified suppressions: single-line disable; if security-related, log in SECURITY.md §12.

## UI Definition of Done (full rubric: `docs/uat-rubric.md`)
Declare the design read first (surface/audience/tone/density); one accent, one primary action per screen, no nested Cards, no emoji-as-icons. Real empty/loading/error states; on-token spacing/colors/type; zod-backed validation messages at the boundary; no dead controls; honest feedback (no green toast over a failure); responsive + RTL (`ar`) + dark hold; axe clean of serious/critical. QA runs in gated tiers: `/design-qa` → `/ship` + risk-based cases → `/uat`, orchestrated by `/qa`; a red gate stops the line. The operator signs off UAT.

## Project tiers
`project.config.json` `"tier": "personal" | "shared"` (default personal). Tier scales ceremony, never the security floor: auth wrappers on every route, no leaked secrets, zod at every boundary, no raw SQL, the ten ESLint rules at `error`, audit log ON, `/ship` before every push. `shared` adds: `/handoff` package, SECURITY.md §9 compliance, CI activation at handoff, formal findings register. `personal` skips those (audit log stays ON).

## Ask before
- Installing a runtime dep > 50 KB minified (needs ADR or `/scale-up` recipe)
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `lib/export.ts`, `lib/api-helpers.ts`, `middleware.ts`, anything under `lib/prisma/`, `eslint-rules/`, or `prisma/migrations/`
- Adding a model to the audit EXCLUDE set; adding a public path or `/api/internal/*` route; bypassing any auth wrapper; changing the `Role` enum or role checks
- Disabling any `rihal-template/*` rule beyond a single-line disable; suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12)
- Pushing to `main` directly when branch protection is on; changing the ADR-001 locked stack (write a superseding ADR first)

## Commands
- `npm run dev` · `npm run ship` (the gate) · `npm run scaffold -- --name <Pascal> --fields '<spec>' [--enums] [--relations] [--writes admin|editor|any]`
- `npm run deploy -- --slug … --display-name … --owner … --admin-email …` · `npm run rebrand -- --slug … --name … --owner …` · `npm run migrate-from -- …`
- `npm test` (contract suite) · `npm run uat` (Playwright; `UAT_BASE_URL` for deployed) · `npm run lint` · `npm run prisma:migrate|:generate|:seed|:studio` · `make db-up` / `db-down`
- Push = deploy: `main` → production, other branches → preview URL.

## Growth path
`/scale-up` has the recipe table (uploads → Vercel Blob, cron → Vercel Cron, jobs → Inngest, realtime → Pusher, PITR → Neon Launch, flags → Edge Config, OAuth → Auth.js providers, errors → Sentry, distributed rate limit → Upstash). None require restructuring.

## Known traps (don't "fix")
- Generated Prisma client lives in `generated/prisma`; imports go through that path.
- Auth.js uses JWT sessions; the `sessions` table is only for OAuth account linking. `middleware.ts` runs on the Node runtime.
- Adding a locale means updating the regex in `middleware.ts` (next-intl strips the prefix).
- Rate limiter is in-memory per-instance — fine until multi-instance; then Upstash via `/scale-up`.
- `sendEmail` returns `{ sent: false }` when `SMTP_HOST` unset — it does NOT throw.
- CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap). Vercel auto-injects `AUTH_URL`; don't set it manually unless wiring a custom domain first.
- `vercel.json` runs `prisma migrate deploy` every build — keep migrations small and forward-compatible; never drop columns the running version still reads. It also ships the daily audit-purge cron (ADR-018; silent no-op until `CRON_SECRET` is set).
- File uploads are not wired (ADR-006); PDF export is intentionally absent from `lib/export.ts` (pdfkit fragile in serverless).
- Docker is an **opt-in self-host rail** (ADR-023), not the default: `output: "standalone"` is gated on `DOCKER_BUILD=1` in `next.config.ts`, so the Vercel build is unchanged. Don't re-enable standalone unconditionally — it does nothing for Vercel. Use `make docker-build` / `make docker-up`; Vercel + Neon stays the default deploy path.
- The root `app/not-found.tsx` is deliberately context-free (no providers): Next 16 prerenders `/_not-found` outside `[locale]`. If a fork's build dies in `/_global-error` or `/_not-found` with a `useContext` TypeError, that's upstream Next regression #85668/#86178 — fix with a context-free root file, never by editing the locale providers. Pinned next@16.2.9 builds clean.
- After large route deletions, a stale `.next` can break typecheck with TS2307 into `.next/types` — `npm run ship` auto-heals this.

When in doubt, stop and ask.
