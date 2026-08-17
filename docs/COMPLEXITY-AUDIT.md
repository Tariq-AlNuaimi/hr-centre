# Template audit — every layer, judged against the objective

**Date:** 2026-08-17 · **Branch:** `claude/template-complexity-audit-dqxq52` · **Scope:** every
tracked file (590 files, 10.99 MB), judged against what this template says it is for.

---

## 0. The yardstick

The template states its own objective in three places, consistently:

> "Rihal internal-tool **prototype** starter … Non-dev stakeholders review via shared URLs; the
> operator iterates, then `/handoff` gives production to IT." — `CLAUDE.md`

> "A **prototype rail**: a reusable Next.js starter that lets a _non-developer operator_ turn an
> idea into a secure, quality, shareable live URL by iterating with Claude — then hand production
> to an IT team." — `docs/repo-architecture.md`

> "Turn one paragraph of an idea into a live URL … in ~10 minutes." — `/quickstart`

And it defines a growth model: **`/scale-up` adds capability on demand** — uploads, cron,
background jobs, realtime, observability, flags, distributed rate limiting. The rail ships thin;
capabilities arrive when a project needs them.

Everything below is judged against that. Not against "is this good engineering" — most of it is
good engineering — but against **"does a prototype rail need this on day one?"**

---

## 1. Verdict

**The template no longer matches its objective.** It has drifted from a prototype rail into an
enterprise platform skeleton, and the drift shows up in four measurable ways:

| Finding                                               | Evidence                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **It pre-ships what `/scale-up` exists to add later** | 4,702 lines / 48 files of dormant enterprise features — AI/RAG, job queue, SSO/SCIM, OpenAPI, OTel/Sentry, Excel export, Valkey — all inherited by every fork |
| **1,450 lines are unreachable from the app at all**   | `lib/ai/**` (792), `lib/queue/**` (211), `lib/export.ts` (135), `KanbanBoard` (193) — verified by import-graph trace from `app/**`                            |
| **The product it actually ships is tiny**             | 5 Prisma models, **4 of them Auth.js boilerplate**. One domain concept: `AuditLog`. Zero business entities                                                    |
| **The governance layer is 2.7× the product**          | 14,466 lines of product vs 23,860 harness + 14,872 docs                                                                                                       |

And underneath that, a second class of problem: **three gates are configured so they cannot
fail**, which is worse than not having them.

---

## 2. Layer-by-layer

Judgment key: **KEEP** · **TRIM** (keep, reduce) · **MOVE** (out of the template, into `/scale-up`
or a recipe) · **CUT**.

### 2.1 Tech stack & runtime dependencies — 41 runtime, 37 dev

| Dependency group                                                                                 | What for             | Reachable? | Judgment                                              |
| ------------------------------------------------------------------------------------------------ | -------------------- | ---------- | ----------------------------------------------------- |
| `next` · `react` · `react-dom` · `typescript`                                                    | the stack (ADR-001)  | yes        | **KEEP**                                              |
| `prisma` · `@prisma/client` · `@prisma/adapter-pg` · `pg`                                        | data layer           | yes        | **KEEP**                                              |
| `next-auth@5.0.0-beta.32` · `@auth/prisma-adapter` · `@node-rs/argon2`                           | auth                 | yes        | **KEEP** — but see §4                                 |
| `zod` · `@hookform/resolvers` · `react-hook-form`                                                | validation/forms     | yes        | **KEEP**                                              |
| `tailwindcss` · 7× `@radix-ui/*` · `clsx` · `cva` · `tailwind-merge` · `lucide-react` · `sonner` | UI (ADR-029)         | yes        | **KEEP**                                              |
| `next-intl`                                                                                      | i18n + RTL           | yes        | **KEEP** (but see §3.2)                               |
| `@tanstack/react-query` · `@tanstack/react-table` · `recharts`                                   | data UI              | yes        | **KEEP**                                              |
| `@anthropic-ai/sdk`                                                                              | `lib/ai` only        | **no**     | **MOVE** — runtime dep for a dead feature             |
| `pg-boss`                                                                                        | `lib/queue` only     | **no**     | **MOVE** — `/scale-up` already lists Inngest for jobs |
| `ioredis`                                                                                        | `lib/valkey.ts` only | **no**     | **MOVE** — `/scale-up` already lists Upstash          |
| `@dnd-kit/core`                                                                                  | `KanbanBoard` only   | **no**     | **CUT** — no consumer anywhere                        |
| `exceljs`                                                                                        | `lib/export.ts` only | **no**     | **MOVE** — no caller in the product                   |
| `@sentry/nextjs` · `@vercel/otel` · `@opentelemetry/api`                                         | observability        | partial    | **MOVE** — `/scale-up` already lists Sentry           |
| `zod-openapi`                                                                                    | `/api/openapi`       | yes        | **TRIM** — a v1 API seam on a prototype               |
| `nodemailer`                                                                                     | `lib/email.ts`       | yes        | **KEEP**                                              |
| `@vercel/speed-insights`                                                                         | telemetry            | yes        | **TRIM**                                              |

**Dev-dependency bloat, same test:** `@stryker-mutator/core` (mutation testing),
`playwright-bdd` (BDD traceability), `@cyclonedx/cyclonedx-npm` (SBOM), `jscpd` (copy-paste
detection), `knip`, `size-limit`, `pixelmatch` + `pngjs` (visual regression), `fast-check`
(property tests), `@changesets/cli`, `@testcontainers/postgresql`, `style-dictionary`,
`@neondatabase/serverless`.

Every one is a legitimate tool. **None belongs in a starter a non-developer forks to build an
internal tool in an afternoon.** Mutation testing and BDD traceability are practices mature teams
adopt after finding a specific problem — pre-installing them means every fork carries the config,
the npm scripts, the docs, and the ADR whether or not anyone runs them.

> **41 runtime dependencies to ship a users table and an audit log.**

### 2.2 Data model — 5 models, 140 schema lines

| Model                                       | Origin                            | Judgment            |
| ------------------------------------------- | --------------------------------- | ------------------- |
| `User`                                      | product + Auth.js                 | **KEEP**            |
| `Account` · `Session` · `VerificationToken` | Auth.js boilerplate               | **KEEP** (required) |
| `AuditLog`                                  | the template's one domain concept | **KEEP**            |
| `Role` enum                                 | RBAC                              | **KEEP**            |

This is the honest core, and it is **right-sized**. The problem is what surrounds it: 8 migrations
for 5 models, two of which (`pgvector_rag`, `scim_external_id`) exist for features with no reachable
code. The pgvector migration creates a `document_embedding` table that `schema.prisma`
**deliberately does not model** — which then required a `RAW_SQL_TABLES` allowlist in `ship.mjs` so
the drift check wouldn't go red. A dormant feature forced a permanent exception into a gate.

**Judgment: CUT both migrations** with the features they serve.

### 2.3 Product surface — 15 pages, 13 API routes, 60 components

| Surface                                               | Count             | Notes         | Judgment                                       |
| ----------------------------------------------------- | ----------------- | ------------- | ---------------------------------------------- |
| Auth pages (login, forgot, reset)                     | 3                 | real          | **KEEP**                                       |
| Dashboard, users (list/new/detail), profile, settings | 6                 | real          | **KEEP**                                       |
| Audit log, recycling bin                              | 2                 | real          | **KEEP**                                       |
| Error pages (forbidden, maintenance)                  | 2                 | real          | **KEEP**                                       |
| **`design-system` + `style-guide` demo pages**        | **2 · 890 lines** | showcase only | **MOVE** to a docs site or strip on `/rebrand` |
| API: users, audit-log, recycling-bin, auth, health    | 10                | real          | **KEEP**                                       |
| API: `internal/scim`                                  | 1                 | dormant SSO   | **MOVE**                                       |
| API: `openapi`                                        | 1                 | v1 seam       | **TRIM**                                       |

**Shared components with no real consumer.**

> **⚠ CORRECTED 2026-08-17.** The first version of this table listed `OrgSwitcher`,
> `NotificationsMenu` and `CommandPalette` as unused. **That was wrong — all three are live.**
> The table was built from a grep matching only `shared/<Name>` / `layout/<Name>` import
> spellings, and `AppHeader` imports them **relatively** (`./OrgSwitcher`), so the consumer was
> missed. The chain is `app/[locale]/(dashboard)/layout.tsx` → `AppShell` → `AppHeader`, so they
> render as chrome on **every dashboard page**; deleting them would have broken the app.
> Both the corrected import-graph trace (§1) and the knip differential (§5.1) omitted these
> three — **the report contradicted its own tool output, and the tools were right.**
> Verified-correct table below.

| Component               | Lines | Used by                                        | Safe to delete? |
| ----------------------- | ----: | ---------------------------------------------- | --------------- |
| `KanbanBoard` + `.impl` |   193 | **nothing**                                    | **yes**         |
| `Modal`                 |    64 | **nothing**                                    | **yes**         |
| `PageShell`             |    31 | **nothing**                                    | **yes**         |
| `DataView`              |     — | style-guide demo only                          | with the demo   |
| `Toolbar`               |     — | style-guide demo + `PageShell`                 | with the demo   |
| 7× `shared/ai/*`        |   343 | design-system + style-guide demos only         | with the demos  |
| ~~`OrgSwitcher`~~       |    51 | **`AppHeader` — live on every dashboard page** | **NO**          |
| ~~`NotificationsMenu`~~ |    55 | **`AppHeader` — live on every dashboard page** | **NO**          |
| ~~`CommandPalette`~~    |     — | **`AppHeader` + `AppShell` — live**            | **NO**          |

So the real dead-primitive set is ~288 lines (`KanbanBoard`, `Modal`, `PageShell`) plus whatever
the demo pages exclusively hold — not the ~500 lines first claimed. The "catalogue, not a library"
point still stands for `DataView`/`Toolbar`/`shared/ai`, which exist to be demonstrated rather than
used; it does **not** apply to the app chrome.

**Method note, since this is the second time the same blind spot bit:** an earlier reachability
trace in this audit also missed relative imports and was rebuilt. The lesson is to match **every**
import spelling — relative, aliased, and JSX usage — and to prefer tool output over a hand-built
summary table.

### 2.4 The dormant enterprise layer — 4,702 lines, 48 files

This is the single largest block of fat in the repo, and the clearest case of mission drift.

| Feature                |  Files |     Lines | Reachable from app? | Env vars needed (none in `.env.example`)                                                        | Judgment |
| ---------------------- | -----: | --------: | ------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| AI / RAG / tracing     |     20 |     1,948 | **no**              | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_AUTH_STYLE`, `AI_TRACE_CONTENT`, `EMBEDDINGS_*` ×5 | **MOVE** |
| SSO / SCIM             |      6 |       999 | partial             | Entra/Polis vars                                                                                | **MOVE** |
| Observability / Sentry |      7 |       492 | partial             | `OTEL_*` ×2                                                                                     | **MOVE** |
| Job queue (pg-boss)    |      4 |       405 | **no**              | `QUEUE_ENABLED`, `QUEUE_DATABASE_URL`                                                           | **MOVE** |
| Excel export           |      3 |       315 | **no**              | —                                                                                               | **MOVE** |
| OpenAPI seam           |      5 |       311 | yes                 | —                                                                                               | **TRIM** |
| Kanban (dnd-kit)       |      2 |       193 | **no**              | —                                                                                               | **CUT**  |
| Valkey / Redis         |      1 |        39 | **no**              | `REDIS_URL`, `VALKEY_URL`                                                                       | **MOVE** |
| **Total**              | **48** | **4,702** |                     | **17 undocumented env vars**                                                                    |          |

Three things make this worse than ordinary dead code:

1. **It is tested.** `tests/contracts/` contains `ai.test.ts`, `ai-embeddings`, `ai-rag`,
   `ai-route`, `ai-tracing`, `queue`, `sso`, `observability`, `openapi`, `sentry-scrub`,
   `export`, `export-column-completeness`. The template maintains a test suite for code nothing
   calls.
2. **It is governed.** `no-direct-anthropic-sdk` is one of the ESLint rules at `error`, guarding
   `lib/ai/**` — a directory with no importers. `no-restricted-export-column` guards
   `lib/export.ts` — which has no caller. `lib/export.ts` is also on the **Ask-before** list, so
   an agent must stop and ask before touching a file nobody uses.
3. **It contradicts `/scale-up`.** The skill's own recipe table lists _"jobs → Inngest, realtime →
   Pusher, errors → Sentry, distributed rate limit → Upstash"_ — capabilities the template has
   **already pre-installed** in a different, dormant form. The growth model and the shipped code
   disagree.

### 2.5 Harness — rules, skills, hooks, gates

Covered in depth in §3 (context) and §5 (integrity). Summary judgment:

| Component             |                  Count | Judgment                                                                                       |
| --------------------- | ---------------------: | ---------------------------------------------------------------------------------------------- |
| Skills                |                     34 | **TRIM → ~18.** Five entry points to testing, four to pre-build analysis, four to provisioning |
| Hooks                 |                     16 | **TRIM → ~10.** 5 fire on every Edit/Write, 4 on every Bash                                    |
| Rules                 |            6 (32.8 KB) | **TRIM.** `harness.md` alone is 19.9 KB — a maintainer manual loaded as a rule                 |
| Agents                |                      4 | **KEEP** — cheap, well-scoped, genuinely useful                                                |
| Enforcement quartet   |                4 gates | **TRIM** — see §5                                                                              |
| `/ship` phases (warm) |                     25 | **TRIM → ~12**                                                                                 |
| npm scripts           |                     68 | **TRIM → ~35**                                                                                 |
| `scripts/`            | 51 files, 12,037 lines | **TRIM → ~30**                                                                                 |

### 2.6 ESLint rules — the security floor

| Rule                          | Guards                 | Still earns it?      |
| ----------------------------- | ---------------------- | -------------------- |
| `no-prisma-in-client`         | architecture boundary  | **yes**              |
| `no-bare-api-route`           | every route wrapped    | **yes**              |
| `no-bare-internal-route`      | internal routes        | **yes**              |
| `no-any-cast-on-session`      | session typing         | **yes**              |
| `no-secret-env-in-console`    | secret leakage         | **yes**              |
| `no-raw-sql-unsafe`           | SQL injection          | **yes**              |
| `no-rate-limit-inside-auth`   | throttle ordering      | **yes**              |
| `no-unaudited-bulk-write`     | audit completeness     | **yes**              |
| `no-prisma-unfiltered-import` | soft-delete bypass     | **yes**              |
| `no-raw-hex-color`            | design tokens          | **yes**              |
| `no-restricted-export-column` | `lib/export.ts`        | **guards dead code** |
| `no-direct-anthropic-sdk`     | `lib/ai/**`            | **guards dead code** |
| `no-arbitrary-className`      | 4px spacing scale      | **limits** — see §4  |
| `no-literal-jsx-text`         | copy through next-intl | **limits** — see §4  |

The nine security rules are the genuinely valuable core and should not be touched. But note:

> **There are 14 rules. `CLAUDE.md`, `harness.md`, and every doc say "thirteen."**
> `no-bare-api-route` is registered in `eslint-rules/index.mjs`, enabled at `error` in
> `eslint.config.mjs`, and absent from the roster that defines the security floor. The document
> that specifies the floor **miscounts the floor**.

### 2.7 Documentation — 138 files, 5.91 MB, 14,872 lines

| Item                                                         | Size        | Judgment                                                         |
| ------------------------------------------------------------ | ----------- | ---------------------------------------------------------------- |
| `docs/verification/**` PNGs                                  | **4.81 MB** | **CUT from git** — 44% of the repo, cloned by every fork         |
| UAT snapshot PNGs                                            | 1.9 MB      | **CUT from git**                                                 |
| 62 ADRs                                                      | 475 KB      | **TRIM** — 19 mention supersession, none are filed as superseded |
| `docs/recipes/**`                                            | 4,655 lines | **TRIM** — 8 of 15 are referenced exactly once (by the index)    |
| `findings-register.md`                                       | 615 lines   | **ARCHIVE** — 0 open wave-offs                                   |
| `build-vs-buy-ledger.md`                                     | 642 lines   | **ARCHIVE** — 42 entries, 0 reversals                            |
| `OPEN-ITEMS.md`                                              | 166 lines   | **TRIM** — half the rows are DONE/MOOT                           |
| `repo-architecture` + `harness-orientation` + `token-policy` | 370 lines   | **MERGE** — three overlapping maps                               |
| `AGENTS.md`                                                  | 3.4 KB      | **TRIM** — calls itself a pointer, restates the rules verbatim   |
| `REPO-MAP.md` · `SECURITY.md` · `README.md`                  | —           | **KEEP**                                                         |

### 2.8 Tests — 74 files, 15,534 lines

| Suite                                  |           Files | Judgment                                                                         |
| -------------------------------------- | --------------: | -------------------------------------------------------------------------------- |
| `tests/contracts`                      |              29 | **TRIM** — 12 of them test dormant features (§2.4)                               |
| `tests/uat`                            |              16 | **TRIM** — 4 are committed PNG baselines (1.9 MB)                                |
| `tests/harness`                        | 5 (1,479 lines) | **TRIM** — `hooks.test.mjs` alone is 1,057 lines testing the harness's own hooks |
| `tests/agent-evals`                    |               9 | **CUT** — two fixture dirs are empty                                             |
| `tests/components`                     |               8 | **KEEP**                                                                         |
| `tests/eslint-rules`                   | 2 (1,028 lines) | **KEEP** — these guard the real floor                                            |
| `tests/property` · `tests/integration` |               5 | **TRIM**                                                                         |

The harness has more test code testing _itself_ (2,507 lines across `harness` + `eslint-rules` +
`agent-evals`) than the product has in `lib/` (2,283 lines).

---

## 3. The context cost (the original complaint)

Measured separately because it compounds everything above.

| Source                                             |      Bytes |    ~Tokens | Metered by `context-tax.mjs`? |
| -------------------------------------------------- | ---------: | ---------: | ----------------------------- |
| `.claude/rules/*.md` — all six, loaded **eagerly** |     32,788 |      8,197 | **no**                        |
| 34 skill descriptions                              |     16,024 |      4,006 | **no**                        |
| MCP — 4 servers / ~160 tools                       |     ~9,000 |     ~2,250 | **no**                        |
| `CLAUDE.md`                                        |      8,185 |      2,046 | yes                           |
| `AGENTS.md`                                        |      3,411 |        852 | **no**                        |
| `agent-memory.md` digest                           |      2,772 |        693 | yes                           |
| SessionStart banner + handoff tables               |      2,036 |        509 | yes                           |
| 4 agent definitions                                |     ~1,400 |       ~350 | **no**                        |
| **Total**                                          | **75,616** | **18,904** | **3 of 8 sources**            |

**The rules are not lazy.** `rules-injection.mjs` was written to serve rule files on demand,
"WITHOUT taxing every session's SessionStart context" — its own comment. But Claude Code
auto-discovers `.claude/rules/*.md` as project instructions and loads **all six** at session start
(verified in this session's system prompt, each labelled _project instructions_). So the 32.8 KB is
paid anyway — and the hook then injects the same file **again** on matching edits.

`context-tax.mjs` measures 3 of 8 sources and reports **"OK vs 20KB"** at 75.6 KB.

---

## 4. Where the harness limits the fork

You asked whether things _limit_. These do — and several contradict the template's own promises.

| Constraint                                                                       | The friction                                | Against the objective                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Blueprint gate denies new pages/routes** until `docs/blueprints/<f>.md` exists | Creating a page is blocked on writing a doc | `/quickstart` promises **idea → live URL in 10 minutes**. The gate makes the first file creation stop and demand a contract |
| **Build-vs-buy gate denies new `lib/` files** until a ledger entry exists        | Every new primitive stops the turn          | 42 entries, 0 reversals — it has never changed an outcome                                                                   |

> **Observed live during this audit.** Writing a two-line throwaway probe file to `lib/` — to be
> deleted seconds later in the same command — was **denied** by `bash-write-gate`, which demanded a
> reuse scan, an `oss-catalog.md` lookup, and a `Considered:`-bearing ledger entry first. The gate
> cannot distinguish a new shared primitive from a temp file. I proved the same point via an
> alternate knip config instead, but that is the friction tax in one observation: **the gate fired,
> cost a turn, and protected nothing.**
> | **`no-literal-jsx-text` at `error`** | Every user-facing string must route through next-intl | The template **ships English-only by default**. A prototype operator pays full i18n ceremony for a language set of one |
> | **`no-arbitrary-className` at `error`** | No arbitrary Tailwind spacing/font values | Reasonable at scale; friction when iterating on a throwaway screen |
> | **Docker is a mandatory build artifact** (ADR-030) | Image build gates `/ship --full`, `/deploy`, `/handoff` | Vercel is the deploy path (ADR-006) and ignores the image entirely |
> | **Locked stack** (ADR-001) | Changing it requires a superseding ADR | Correct for a shared standard; heavy for a prototype rail |
> | **Tier enforcement** | ≥2 contributors on `personal` fails `/ship` | Fine — cheap and real |
> | **Visual-iteration loop** (V2-301) | Any screen change requires capture + view + critique + re-capture | Right instinct, but the matrix is desktop+mobile × light+dark × every locale = 8+ images per screen |

The pattern: **the harness is calibrated for a shared, long-lived, multi-contributor production
system. The product objective is a disposable prototype an operator ships in an afternoon.** Both
are coherent designs. They are not the same design, and the template is currently trying to be
both.

---

## 5. Gates that cannot fail

Three integrity failures. Each reads green permanently, which is worse than absence — absence is
visible.

**5.1 `knip` cannot find dead code where dead code lives.** `knip.json` declares
`lib/**`, `components/shared/**`, `components/ui/**`, `hooks/**` as **entry points**. An entry
point is by definition reachable, so the dead-code gate is structurally blind to the entire `lib/`
and shared-component surface — exactly where the dead code is.

**Verified empirically.** Same repo, same code, only the `entry` array changed:

| Config                      | `entry` includes `lib/**`, `components/shared/**`? | knip output                                                  |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| **A — as shipped**          | yes                                                | **nothing. Clean.**                                          |
| **B — those globs removed** | no                                                 | **5 unused files · 1 unused dependency · 31 unused exports** |

Config B surfaces `KanbanBoard` + `.impl`, `Modal`, `PageShell`, `lib/sso/index.ts`, the
`@dnd-kit/core` dependency, and 31 dead exports including `ragUpsert`, `ragQuery`,
`isAiConfigured`, and `AiNotConfiguredError`. **All of it is invisible to the gate as configured.**

**A second, compounding blindness:** `tests/**` is also an entry point, so any dead product file
imported by its own contract test is reachable by definition. `lib/ai/**` survives even config B for
this reason — the 12 contract tests written for the dormant features are precisely what hide those
features from dead-code detection. **The tests keep their own subject alive.**

**5.2 `context-tax.mjs` measures a third of its own budget.** §3.

**5.3 `db-structure` degrades silently.** It reported `PASS*` in my run — the migrations-in-sync
sub-check is skipped whenever `SHADOW_DATABASE_URL` is unset, which nothing in the repo sets. The
harness already documented this exact lesson in `harness.md` ("a check that degrades quietly when a
prerequisite is missing will read as green forever") — and then two more gates were built with the
same flaw.

---

## 6. Consolidated cut list

| #      | Cut                                                                                                                                                                                                                                     | Removes                                                                        | Risk                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| **A1** | Move the dormant enterprise layer to `/scale-up` recipes — AI/RAG, queue, SSO/SCIM, Sentry/OTel, Valkey, export                                                                                                                         | **4,702 lines · 48 files · 8 runtime deps · 12 contract tests · 2 migrations** | low — nothing imports it |
| **A2** | Delete `KanbanBoard`, `Modal`, `PageShell` (verified zero consumers); `DataView`/`Toolbar`/`shared/ai` go with the demo pages. **NOT `OrgSwitcher`/`NotificationsMenu`/`CommandPalette` — live app chrome, see the correction in §2.3** | ~288 lines + `@dnd-kit`                                                        | low                      |
| **A3** | Move the two demo pages out of the app                                                                                                                                                                                                  | 890 lines                                                                      | low                      |
| **A4** | Retire mutation testing, BDD traceability, SBOM, jscpd, visual-regression, changesets from the default rail                                                                                                                             | ~10 dev deps, ~15 npm scripts, 4 ADRs                                          | low                      |
| **B1** | Stop the eager rules load; split `harness.md`; cut `AGENTS.md` to a pointer; prune MCP                                                                                                                                                  | **~11.5K tokens/session**                                                      | low                      |
| **B2** | Fix the three blind gates (§5) — or delete them                                                                                                                                                                                         | —                                                                              | low, high value          |
| **B3** | 34 skills → ~18; 68 npm scripts → ~35; 51 scripts → ~30; 16 hooks → ~10                                                                                                                                                                 | ~7 KB always-on                                                                | medium                   |
| **C1** | 6.7 MB of PNGs out of git                                                                                                                                                                                                               | **61% of repo bytes**                                                          | medium                   |
| **C2** | Warm `/ship` 25 phases → ~12 (all security stays warm)                                                                                                                                                                                  | ~35s per loop                                                                  | medium                   |
| **C3** | Downgrade build-vs-buy and blueprint gates from **deny** to warn for `/quickstart`-tier work                                                                                                                                            | unblocks the 10-minute promise                                                 | **needs your call**      |
| **C4** | Archive cold governance docs; merge the three map docs; file superseded ADRs                                                                                                                                                            | ~1,400 lines                                                                   | low                      |

**Projected:** product stays at ~14,500 lines. Harness + docs drops from 38,700 to roughly 20,000.
Repo from 11.0 MB to ~4.3 MB. Runtime deps from 41 to ~30. Always-on context from ~18,900 tokens
to ~4,000.

---

## 7. The structural diagnosis

Three separate failure modes produced this, and they need different fixes.

**7.1 Mission drift.** Enterprise features were added to a prototype rail — each with a real ADR,
each defensible alone — without anyone asking whether the rail was still a rail. `/scale-up` was
built as the mechanism for exactly this, and then bypassed. **Fix: enforce the growth model. If a
capability has a `/scale-up` recipe, it does not ship pre-installed.**

**7.2 Nothing was ever removed.** 62 ADRs, zero filed as superseded. 34 skills, none retired. 51
scripts, none deleted. The harness is append-only. **Fix: every addition names what it replaces or
carries a delete-by date.**

**7.3 Gates were trusted instead of tested.** Three of them cannot fail. The `db-structure` lesson
was written down in `harness.md` and then repeated twice. **Fix: every gate needs a test that
proves it goes red — the `eslint-rules` suite already does this correctly and is the model.**

The security floor — auth wrappers, zod at the boundary, the nine security ESLint rules, the audit
log, gitleaks, `/ship` before push — is sound, proportionate, and should survive all of this
untouched. **It is roughly 10% of the harness. The other 90% is what drifted.**
