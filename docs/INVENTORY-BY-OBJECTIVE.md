# Inventory by Objective

A re-cut of the harness catalog, grouped by **what each item is for** rather
than by file type. Every item from the eight file-type sections of
[`docs/REPO-INVENTORY.md`](./REPO-INVENTORY.md) is placed under its **primary
objective**; secondary objectives are noted inline. Results come from
[`docs/TRIALS.md`](./TRIALS.md) (trial date 2026-07-03) — this document does
**not** re-derive them.

> **How to read the `Section` column** — the item's home in the file-type
> inventory: **S1** Skills · **S2** Agents · **S3** Hooks · **S4** ESLint rules
> · **S5** Scripts · **S6** npm actions · **S7** Documents · **S8** External MCP
> tools.

**Result legend** (from TRIALS): ✅ PASS · 🟡 PARTIAL (worked with a workaround
or a live-only leg pending a prerequisite) · ⛔ BLOCKED (env prerequisite
missing) · ❌ FAIL · — not trialed standalone.

## Objectives at a glance

| #   | Objective bucket                   | What it is for                                          | Items |
| --- | ---------------------------------- | ------------------------------------------------------- | ----: |
| A   | **Provision & Deploy**             | Get a repo to a live shareable URL                      |     6 |
| B   | **Build Features**                 | Turn an idea into a working screen + data model         |    19 |
| C   | **Quality Gates & Verification**   | Prove a change is correct before it ships               |    38 |
| D   | **Security & Secrets**             | Keep credentials, auth, and the audit trail intact      |    15 |
| E   | **Session & Knowledge Continuity** | Survive the ephemeral container; carry state forward    |    17 |
| F   | **Maintenance & Migration**        | Keep forks current; move code and data between projects |    15 |
| G   | **Docs & Decisions**               | Record why the system is the way it is                  |    41 |
| H   | **Tooling & Meta-Agents**          | The reusable infrastructure the other buckets run on    |    12 |

The **Items** count is the number of table rows in each bucket, except: **E**
counts 17 (18 rows; `repo-map` appears as both a script and its npm wrapper —
one item), **H** counts 12 (13 rows; `Replit` is listed but unauthorized), and
**G** counts 41 (10 rows, but the single ADR-corpus row fans out to 31 numbered
ADRs + 1 template = 32 files). A couple of rows elsewhere bundle two npm
entrypoints (e.g. A's `deploy` / `new-project`).

Cross-check against `REPO-INVENTORY.md`: 26 skills + 2 agents + 11 hooks + 10
ESLint rules + 19 scripts (18 + `lib/log.mjs`) + 43 live npm actions
(`package.json`; the inventory's headline "44" doesn't match the live
`package.json`, which has 43 — a miscount at authoring time, not a later change)

- documents (5 root + 13 `docs/` + 31 ADRs + 1 ADR template) + 5 MCP servers.
  Every one is placed below exactly once.

---

## A. Provision & Deploy

**Objective:** take a fork from "exists on GitHub" to "live at a URL the team
can open." _Secure_ and _Fast_ pillars apply from the first push — the
provisioners preflight egress before touching a token (TRIALS §Env-truth 2:
tokens here are live, not dry-run; `deploy.mjs` rolled back a stray Neon project
automatically).

| Item                           | Section | Objective it serves                                  | Result | Key note                                                                                                   |
| ------------------------------ | ------- | ---------------------------------------------------- | :----: | ---------------------------------------------------------------------------------------------------------- |
| `deploy`                       | S1      | Provision Neon + Vercel for an existing repo → URL   |   🟡   | Live path + rollback verified; needs a real slug/owner + `VERCEL_TOKEN`/`NEON_API_KEY` (present here).     |
| `new-project`                  | S1      | One-prompt GitHub + Neon + Vercel + CNAME            |   🟡   | Egress/Neon OK; GitHub 403 on invalid `--owner`. Needs `GH_AUTOMATION_TOKEN` (repo+workflow) + real owner. |
| `first-fork`                   | S1      | Guided first-time fork setup for non-devs            |   ⛔   | Interactive Vercel/Neon console steps — not automatable in this env.                                       |
| `deploy.mjs`                   | S5      | Engine behind `/deploy`                              |   🟡   | 1.5s to fail-fast; `teardown()`/`bailWithRollback` verified (0 orphans).                                   |
| `new-project.mjs`              | S5      | Engine behind `/new-project`                         |   🟡   | 0.8s to fail; egress+Neon OK, GitHub 403 on bad owner.                                                     |
| `deploy` / `new-project` (npm) | S6      | `npm run deploy` / `npm run new-project` entrypoints |   🟡   | Same live-token behavior as the skills above.                                                              |

---

## B. Build Features

**Objective:** turn a paragraph of intent into a working, on-token screen backed
by a real data model — the _Maintainable_ pillar's "reuse existing primitives"
starts here. Blueprint gates the build; scaffold + design-system + stack-advisor
shape the code; the Prisma/dev actions run it.

| Item                     | Section | Objective it serves                                         | Result | Key note                                                                                         |
| ------------------------ | ------- | ----------------------------------------------------------- | :----: | ------------------------------------------------------------------------------------------------ |
| `blueprint`              | S1      | Pre-build gate: stories + happy/worst scenarios + tier      |   ✅   | Gate mechanic verified. Trap: empty domain grid blocks sign-off (ADR-031).                       |
| `scaffold-entity`        | S1      | End-to-end CRUD: model + zod + routes + pages + nav + bin   |   ✅   | Dry-run byte-identical, 6/6 contract. **i18n merge is manual & mandatory** or UI shows raw keys. |
| `quickstart`             | S1      | One paragraph → live URL (composes scaffold + push)         |   —    | Not trialed standalone; inherits scaffold-entity ✅ + deploy 🟡.                                 |
| `stack-advisor`          | S1      | Build-time RSC/Prisma/Postgres pattern expert               |   ✅   | Advisory; recipes present. Secondary: _Speed_/_Scalable_ (bounded queries).                      |
| `design-system`          | S1      | Build on-token, RTL/dark, accessible UI on first pass       |   ✅   | Recipes + shared primitives present. Secondary: _High-Quality_.                                  |
| `scaffold-entity.mjs`    | S5      | Engine behind `/scaffold-entity` (1412 LOC)                 |   ✅   | ~2s codegen; contract test 6/6.                                                                  |
| `build-tokens.mjs`       | S5      | Style-Dictionary design-token pipeline                      |   ✅   | 161ms; backs `tokens:build`.                                                                     |
| `dev`                    | S6      | `next dev` local run                                        |   ⛔   | Needs DB to be useful.                                                                           |
| `build`                  | S6      | `next build` production build                               |   ✅   | Runs green via `/ship` (~25s). Secondary: gate C.                                                |
| `start`                  | S6      | `next start` serve the built app                            |   ⛔   | Needs DB to be useful.                                                                           |
| `tokens:build`           | S6      | Regenerate design tokens                                    |   ✅   | 0.4s.                                                                                            |
| `scaffold`               | S6      | `npm run scaffold -- …`                                     |   ✅   | Wrapper for the scaffold engine.                                                                 |
| `prisma:generate`        | S6      | Generate the Prisma client                                  |   🟡   | Needs `DATABASE_URL` (placeholder OK); fixed to fall back — §9 #2.                               |
| `prisma:migrate`         | S6      | `prisma migrate dev`                                        |   ⛔   | Needs DB.                                                                                        |
| `prisma:push`            | S6      | `prisma db push`                                            |   ⛔   | Needs DB.                                                                                        |
| `prisma:seed`            | S6      | `prisma db seed`                                            |   ⛔   | Needs DB.                                                                                        |
| `prisma:studio`          | S6      | Prisma Studio GUI                                           |   ⛔   | Needs DB.                                                                                        |
| `docs/design-recipes.md` | S7      | Copy-paste **design** patterns + slop gate                  |   ✅   | Present/current; the source `/design-system` builds from.                                        |
| `docs/recipes.md`        | S7      | Copy-paste **code** examples (email, Excel, kanban, charts) |   ✅   | Present/current.                                                                                 |

---

## C. Quality Gates & Verification

**Objective:** prove a change satisfies the Five Pillars before it ships. This
is the largest bucket by design — `/ship` is the active gate on the free plan,
and QA runs in gated tiers (design-qa → ship → uat). The two ESLint rules here
guard _Maintainable_/_High-Quality_; the eight security rules live in bucket D.

| Item                        | Section | Objective it serves                                     | Result | Key note                                                                  |
| --------------------------- | ------- | ------------------------------------------------------- | :----: | ------------------------------------------------------------------------- |
| `ship`                      | S1      | The gate: typecheck+lint+test+build+secretscan+audit    |   ✅   | ~43s, 16 gates green. Trap: gitleaks must be on PATH (hard fail).         |
| `qa`                        | S1      | Orchestrate design-qa → ship → uat in gated order       |   🟡   | Tier-2 (`/ship`) proven; Tiers 1&3 need browser + operator sign-off.      |
| `design-qa`                 | S1      | Screenshot every screen/state, axe, diff vs design      |   🟡   | Needs browser; project Playwright works, MCP fixed (§8).                  |
| `uat`                       | S1      | Browser acceptance test (lean smoke / full audit)       |   🟡   | Browser launched vs live URL; needs `UAT_EMAIL`/`UAT_PASSWORD`.           |
| `manual-uat`                | S1      | Agent drives browser as a real user, live RBAC per role |   🟡   | Needs working browser driver + seeded role logins.                        |
| `cover`                     | S1      | AI test-gen to close the coverage floor (node:test)     |   🟡   | `test:coverage` runs; needs Node ≥22.13 to enforce floor.                 |
| `no-prisma-in-client`       | S4      | Block `prisma` in client components (layering)          |   ✅   | Unit-tested green; _Maintainable_ architecture gate.                      |
| `no-raw-hex-color`          | S4      | Block raw hex; force design tokens                      |   ✅   | Unit-tested green; _High-Quality_/token discipline (ADR-015).             |
| `ship.mjs`                  | S5      | Engine behind `/ship` (879 LOC)                         |   ✅   | Ran the gate on itself (~43s).                                            |
| `uat-pdf.mjs`               | S5      | Render the UAT PDF report                               |   ⛔   | Needs P1–P6 JSON from a full UAT run.                                     |
| `rbac-matrix.mjs`           | S5      | Compute expected RBAC matrix for manual-uat             |   ✅   | 44ms; wrote `rbac-expected.json`.                                         |
| `uat-recommend.mjs`         | S5      | Logic/UX recommendations from a UAT run                 |   ✅   | 0.1s; 0 recos on no input (graceful).                                     |
| `manual-uat-users.mjs`      | S5      | Seed/skip per-role test users                           |   ✅   | 0.5s via `tsx`; **never run with bare `node`** (§9 #1).                   |
| `uat-benchmark.mjs`         | S5      | Peer/enterprise benchmark for UAT                       |   ⛔   | Needs web search + a target.                                              |
| `lint`                      | S6      | ESLint incl. the 10 local rules                         |   ✅   | 8.3s.                                                                     |
| `test`                      | S6      | Contract + property suite + lint-rules                  |   ✅   | 3.7s.                                                                     |
| `test:property`             | S6      | Property-based tests                                    |   ✅   | 0.6s.                                                                     |
| `test:watch`                | S6      | Watch-mode contract tests                               |   —    | Dev convenience; not separately timed.                                    |
| `test:lint-rules`           | S6      | Unit tests for the 10 ESLint rules                      |   ✅   | 1.3s (all 10 fire).                                                       |
| `test:integration`          | S6      | Integration tests                                       |   🟡   | 0.6s; DB-bound cases skip without DB.                                     |
| `test:components`           | S6      | React component tests (jsdom)                           |   ✅   | 2.8s.                                                                     |
| `test:coverage`             | S6      | Coverage run feeding the floor                          |   ✅   | ~10s.                                                                     |
| `uat`                       | S6      | `npm run uat` — lean browser smoke                      |   🟡   | Same live-launch behavior as the `/uat` skill; needs creds + running app. |
| `uat:full`                  | S6      | Full deep UAT audit                                     |   ⛔   | Needs full UAT inputs.                                                    |
| `uat:headed`                | S6      | Headed (visible) lean UAT                               |   ⛔   | Needs creds + a display, like `uat`.                                      |
| `uat:report`                | S6      | Open the last Playwright UAT report                     |   ⛔   | Needs a prior report.                                                     |
| `uat:pdf`                   | S6      | `npm run uat:pdf`                                       |   ⛔   | Needs full-UAT JSON.                                                      |
| `uat:recommend`             | S6      | `npm run uat:recommend`                                 |   ✅   | See `uat-recommend.mjs`.                                                  |
| `uat:benchmark`             | S6      | `npm run uat:benchmark`                                 |   ⛔   | Needs web search + target.                                                |
| `uat:install`               | S6      | Install Chromium for Playwright                         |   ✅   | Chromium pre-installed at `/opt/pw-browsers`.                             |
| `manual-uat:matrix`         | S6      | `npm run manual-uat:matrix`                             |   ✅   | Via `rbac-matrix.mjs`.                                                    |
| `manual-uat:users`          | S6      | `npm run manual-uat:users`                              |   ✅   | 0.5s via `tsx`.                                                           |
| `analyze`                   | S6      | `ANALYZE=true next build` bundle report                 |   ⛔   | Heavy ANALYZE build, not run. _Speed_/_Scalable_.                         |
| `scan`                      | S6      | react-scan render profiling                             |   ⛔   | Needs a running app. _Speed_.                                             |
| `lhci`                      | S6      | Lighthouse CI                                           |   ⛔   | Needs a running app. _Speed_/_High-Quality_.                              |
| `ship` (npm)                | S6      | `npm run ship` entrypoint                               |   ✅   | ~43s warm.                                                                |
| `docs/uat-rubric.md`        | S7      | The 5-pillar scoring rubric QA traces against           |   ✅   | Present/current; anchors design-qa + qa scores.                           |
| `docs/findings-register.md` | S7      | Wave-off ledger `/ship` hard-fails on if `open`         |   ✅   | Present/current. Secondary: bucket D adjudication.                        |

_(The `senior-code-reviewer` agent is the post-push breadth pass; it is filed
under H as reusable infrastructure, but its objective is verification — read it
alongside this bucket.)_

---

## D. Security & Secrets

**Objective:** the _Secure_ pillar's floor — credentials never leak, auth
wrappers are always present, the audit trail is complete, and no unparameterized
SQL or unaudited bulk write slips through. Eight of the eleven ESLint rules live
here (their primary objective is a security invariant); all are enforced by
`lint`/`ship` (bucket C's mechanism), so the _mechanism_ is shared but the
_objective_ is security.

| Item                          | Section | Objective it serves                                    | Result | Key note                                                                           |
| ----------------------------- | ------- | ------------------------------------------------------ | :----: | ---------------------------------------------------------------------------------- |
| `audit`                       | S1      | gitleaks + npm audit + Semgrep security scan           |   🟡   | gitleaks/npm-audit run; **Semgrep binary absent** (§9 #6: `pipx install semgrep`). |
| `protect-secrets.mjs`         | S3      | Block reads/writes touching secrets (PreToolUse)       |   ✅   | Blocked `.env` read live and via stdin (`deny`).                                   |
| `post-tool-scan.mjs`          | S3      | Scan tool output for secrets/findings (PostToolUse)    |   ✅   | Clean output → pass-through.                                                       |
| `dangerous-commands.mjs`      | S3      | Block destructive git/shell (PreToolUse)               |   ✅   | Blocked `git push --force`; allowed `git status`.                                  |
| `no-secret-env-in-console`    | S4      | Block logging Restricted env vars                      |   ✅   | Unit-tested green; SECURITY.md §1.                                                 |
| `no-bare-internal-route`      | S4      | Force `withInternalAuth` on `/api/internal/*`          |   ✅   | Unit-tested green; auth wrapper gate.                                              |
| `no-raw-sql-unsafe`           | S4      | Block `$queryRawUnsafe`/`$executeRawUnsafe`            |   ✅   | Unit-tested green; OWASP A03.                                                      |
| `no-restricted-export-column` | S4      | Block secret-named field as an Excel column            |   ✅   | Unit-tested green; export leak (SCRUB_FIELDS ≠ exports).                           |
| `no-prisma-unfiltered-import` | S4      | Restrict `prismaUnfiltered` to allowlisted files       |   ✅   | Unit-tested green; bypasses soft-delete + audit.                                   |
| `no-rate-limit-inside-auth`   | S4      | Force `withRateLimit` OUTSIDE the auth wrapper         |   ✅   | Unit-tested green; OWASP A04 / DoS.                                                |
| `no-any-cast-on-session`      | S4      | Block casting `session` to `any`                       |   ✅   | Unit-tested green; role-integrity.                                                 |
| `no-unaudited-bulk-write`     | S4      | Block bulk/upsert bypassing the audit log              |   ✅   | Unit-tested green; ADR-010 audit completeness.                                     |
| `sbom`                        | S6      | CycloneDX SBOM (supply-chain inventory)                |   ✅   | 1.9s.                                                                              |
| `audit:warn`                  | S6      | `npm audit --audit-level=moderate` (non-blocking)      |   ✅   | 0.9s.                                                                              |
| `SECURITY.md`                 | S7      | Data classes, secrets, threat model, findings register |   ✅   | Present/current (344 LOC).                                                         |

---

## E. Session & Knowledge Continuity

**Objective:** the container is ephemeral and the next session clones **only
what was pushed** — this bucket is the machinery that survives that. Push gates,
handoffs, durable memory, and the repo-map that answers "where is X" for free.
The _Maintainable_ pillar depends on it (don't rediscover what a past session
learned).

| Item                      | Section | Objective it serves                                    | Result | Key note                                                       |
| ------------------------- | ------- | ------------------------------------------------------ | :----: | -------------------------------------------------------------- |
| `handoff`                 | S1      | IT-team handoff package (HANDOFF.md)                   |   ⛔   | Needs `tier:"shared"` + Docker build. Cross-_team_ handoff.    |
| `handoff-session`         | S1      | Committed + inline handoff for a fresh session         |   ✅   | Verify push `@{u}..HEAD=0`. Cross-_session_ handoff.           |
| `remember`                | S1      | Append a durable dated entry to agent-memory           |   ✅   | One line → **push**; 150-line budget = manual triage.          |
| `session-start.sh`        | S3      | Bootstrap deps/Prisma/repo-map at boot (SessionStart)  |   ✅   | Ran live: installed deps, generated client, refreshed map.     |
| `session-stop.mjs`        | S3      | Hard-block ending with unpushed commits (Stop)         |   ✅   | Fired live repeatedly; the pushed-or-it-didn't-happen gate.    |
| `auto-handoff.mjs`        | S3      | Auto-generate session handoff (SessionEnd/Stop)        |   🟡   | Wired; not directly triggered this session.                    |
| `pre-compact-refresh.mjs` | S3      | Refresh state before compaction (PreCompact)           |   🟡   | Wired; no compaction occurred.                                 |
| `session-receipt.mjs`     | S3      | Write a session receipt (SessionEnd)                   |   🟡   | Wired; session still open.                                     |
| `render-handoff.mjs`      | S5      | Render the handoff status tables                       |   ✅   | 37ms, byte-stable.                                             |
| `repo-map.mjs`            | S5      | Regenerate `docs/REPO-MAP.md`                          |   ✅   | 36ms, md5-stable.                                              |
| `auto-spawn-guard.mjs`    | S5      | Guard session auto-spawn                               |   ✅   | Exit 3 BLOCKED as designed.                                    |
| `auto-spawn-fire.mjs`     | S5      | Fire session auto-spawn                                |   ✅   | Exit 0; `--schema` prints skeleton.                            |
| `repo-map` (npm)          | S6      | `npm run repo-map`                                     |   ✅   | <0.1s.                                                         |
| `docs/agent-memory.md`    | S7      | Durable cross-session decisions/gotchas (SessionStart) |   ✅   | Present/current (201 LOC); reaches `main`, inherited by forks. |
| `docs/SESSION-HANDOFF.md` | S7      | In-flight state committed to the branch (never merged) |   ✅   | Present/current (162 LOC).                                     |
| `docs/REPO-MAP.md`        | S7      | "Where is X" map (free orientation)                    |   ✅   | Regenerates byte-identical (accurate).                         |
| `docs/token-policy.md`    | S7      | Token-thrift rules for sessions (ADR-019)              |   ✅   | Present/current (112 LOC). Secondary: token thrift.            |

_(That is 18 rows; the glance table counts 17 because `repo-map` appears as both
a script and its npm wrapper — one objective, two entry points.)_

---

## F. Maintenance & Migration

**Objective:** keep a fork current with the template, move code/data between
projects, add growth capabilities, and manage releases — the lifecycle work
_after_ the first build. _Maintainable_ and _Scalable_ pillars.

| Item                     | Section | Objective it serves                                   | Result | Key note                                                       |
| ------------------------ | ------- | ----------------------------------------------------- | :----: | -------------------------------------------------------------- |
| `scale-up`               | S1      | Recipe table to add uploads/cron/jobs/realtime/…      |   ✅   | 15 recipes present; suggests, never auto-installs. _Scalable_. |
| `sync-from-template`     | S1      | Pull later template layers into a fork (additive)     |   ✅   | `--check` clean. Trap: `settings.json` is REVIEW (§9 #9).      |
| `migrate-from`           | S1      | Pull schema + data from a source Postgres             |   ⛔   | Needs source **and** target Postgres + `pg_dump`/`psql`.       |
| `rebrand`                | S1      | Sweep hardcoded identity → fork identity              |   🟡   | Mutating; `--dry-run` exists, not run live.                    |
| `conform`                | S1      | Bring foreign code to template standard → new repo    |   🟡   | Depends on `/audit` (Semgrep absent). Secondary: security.     |
| `batch`                  | S1      | Run a per-file codemod as capped headless `claude -p` |   🟡   | Needs authenticated `claude` CLI; cost tracking manual.        |
| `docker`                 | S1      | Containerize the app (build/run/full stack)           |   ⛔   | No Docker daemon in this env (ADR-030). Secondary: handoff.    |
| `sync-from-template.mjs` | S5      | Engine behind `/sync-from-template`                   |   ✅   | 0.4s; `--check` clean.                                         |
| `migrate-from.mjs`       | S5      | Engine behind `/migrate-from`                         |   ⛔   | Needs source+target Postgres.                                  |
| `rebrand.mjs`            | S5      | Engine behind `/rebrand`                              |   🟡   | Mutating; `--dry-run` available.                               |
| `rebrand` (npm)          | S6      | `npm run rebrand -- …`                                |   🟡   | Same as skill.                                                 |
| `migrate-from` (npm)     | S6      | `npm run migrate-from -- …`                           |   ⛔   | Needs two DBs.                                                 |
| `sync-template` (npm)    | S6      | `npm run sync-template`                               |   ✅   | 0.4s.                                                          |
| `changeset`              | S6      | Author a release changeset                            |   🟡   | Interactive; not run.                                          |
| `changeset:version`      | S6      | Apply changesets → version bump                       |   🟡   | Interactive; not run.                                          |

---

## G. Docs & Decisions

**Objective:** record _why_ the system is the way it is — the ADR corpus, the
operating manuals, and the planning/comparison notes. Read-only knowledge; no
trial "result" beyond present/current (TRIALS §7: no stale/missing docs found).

| Item                                        | Section | Objective it serves                                          | Result | Key note                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ------------------------------------------------------------ | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr`                                       | S1      | Create a new ADR under `docs/decisions/`                     |   ✅   | Template present; numbering scan works.                                                                                                                                                                        |
| `README.md`                                 | S7      | Stack overview + project structure                           |   ✅   | Present/current (199 LOC).                                                                                                                                                                                     |
| `CLAUDE.md`                                 | S7      | Binding project instructions + hard rules                    |   ✅   | Present/current (99 LOC).                                                                                                                                                                                      |
| `AGENTS.md`                                 | S7      | Agent-facing operating notes                                 |   ✅   | Present/current (61 LOC).                                                                                                                                                                                      |
| `CHANGELOG.md`                              | S7      | Human-readable change history                                |   ✅   | Present/current (58 LOC).                                                                                                                                                                                      |
| `docs/claude-ecosystem-comparison.md`       | S7      | Ecosystem comparison (part 1)                                |   ✅   | Present/current (218 LOC).                                                                                                                                                                                     |
| `docs/claude-ecosystem-comparison-part2.md` | S7      | Ecosystem comparison (part 2)                                |   ✅   | Present/current (391 LOC).                                                                                                                                                                                     |
| `docs/deferred-adoption-plan.md`            | S7      | Deferred-work plan                                           |   ✅   | Present/current (184 LOC).                                                                                                                                                                                     |
| `docs/plugin-eval-2026-07.md`               | S7      | Plugin evaluation notes                                      |   ✅   | Present/current (142 LOC).                                                                                                                                                                                     |
| ADR-001 … ADR-031 + `ADR-TEMPLATE.md`       | S7      | 31 numbered decision records + 1 template (the "why" ledger) |   ✅   | All present (TRIALS §7). Notable: ADR-001 stack lock, ADR-006 Vercel/Neon, ADR-010 audit completeness, ADR-015 design-taste, ADR-026/028/029 design system, ADR-023/030 Docker, ADR-031 structured-DB mandate. |

_(The ADR row is one line for the full numbered series, mirroring how
`REPO-INVENTORY.md` §7 counts them as a group — ADR-001…ADR-031 = 31 records, +
template = 32 ADR-corpus files.)_

---

## H. Tooling & Meta-Agents

**Objective:** the reusable infrastructure the other seven buckets stand on —
the investigator agent everything delegates to, the post-push reviewer, the
harness plumbing hooks, shared utilities, and the external MCP servers that
power provisioning, browsing, and design.

| Item                        | Section | Objective it serves                                   | Result | Key note                                                                                                                                                                                    |
| --------------------------- | ------- | ----------------------------------------------------- | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout`                     | S2      | Cheap read-only repo investigator (haiku)             |   ✅   | Used twice this session; grounded, cited reports. Token-thrift primitive.                                                                                                                   |
| `senior-code-reviewer`      | S2      | Post-push whole-change breadth review                 |   🟡   | Available; runs post-push (not spawned this trial). Objective: verification (bucket C).                                                                                                     |
| `skill-activation.mjs`      | S3      | Suggest/activate skills from rules (UserPromptSubmit) |   ✅   | `"deploy this"` → suggested `/deploy` via `additionalContext`.                                                                                                                              |
| `verbose-guard.mjs`         | S3      | Guard against overly verbose output (PreToolUse)      |   ✅   | Pass-through when not verbose. Secondary: token thrift.                                                                                                                                     |
| `install-senior-review.mjs` | S5      | Port the senior-review rig into any repo              |   🟡   | Portability installer; needs a target repo.                                                                                                                                                 |
| `lib/log.mjs`               | S5      | Shared logging util for all scripts                   |   ✅   | Implicitly proven by every script trial.                                                                                                                                                    |
| `prepare`                   | S6      | Husky git-hook install on `npm install`               |   ✅   | Ran at SessionStart (deps install).                                                                                                                                                         |
| `docs/mcp.md`               | S7      | MCP server reference                                  |   ✅   | Present/current (35 LOC).                                                                                                                                                                   |
| `github` (MCP)              | S8      | Full PR/issue/CI/repo API                             |   ✅   | In scope, tools available.                                                                                                                                                                  |
| `playwright` (MCP)          | S8      | Browser automation for QA tiers                       |   🟡   | `--browser chromium` alone still demanded `chrome-for-testing`; now pinned to the pre-installed Chromium via a dynamic `--executable-path` glob in `.mcp.json` (takes effect next session). |
| `Figma` (MCP)               | S8      | Design ↔ code bridge                                  |   ✅   | Available; not exercised.                                                                                                                                                                   |
| `context7` (MCP)            | S8      | Live library docs                                     |   ✅   | Available; not exercised.                                                                                                                                                                   |
| `Replit` (MCP)              | S8      | (session-provided)                                    |   ⛔   | Requires OAuth; can't authorize non-interactively.                                                                                                                                          |

_(That is 13 rows; the glance table counts 12 because `Replit` is listed for
completeness but is unauthorized — the 12 usable tooling items plus the blocked
one.)_

---

## Coverage cross-check

| Section           |                                  Inventory count | Placed here | Buckets touched |
| ----------------- | -----------------------------------------------: | ----------: | --------------- |
| S1 Skills         |                                               26 |          26 | A B C D E F G   |
| S2 Agents         |                                                2 |           2 | H               |
| S3 Hooks          |                                               11 |          11 | D E H           |
| S4 ESLint rules   |                                               10 |          10 | C D             |
| S5 Scripts (+lib) |                                               19 |          19 | A B C E F H     |
| S6 npm actions    |                                   43 (inv. "44") |          43 | A B C D E F H   |
| S7 Documents      | 5 root + 13 docs + 32 ADR corpus (31 + template) |         all | B C D E G H     |
| S8 MCP tools      |                                                5 |           5 | H               |

No item from any section is dropped; each appears under exactly one primary
objective, with cross-objective ties noted inline (e.g. the 8 security ESLint
rules are enforced by the _quality_ mechanism but serve the _security_
objective; `handoff`/`conform`/`docker` carry secondary objectives spanning
buckets).
