# Maintainer runbook — evolving the harness safely

**Answers:** I need to change a gate / hook / ESLint rule / ADR / permission — how do I do
it without silently weakening the floor? · **Owner:** Maintainer · **Last reviewed:** 2026-07-17

This is the **bus-factor floor** (V2-505): the procedure a NEW maintainer follows to evolve
the harness — the `.claude/` machinery, the `/ship` gates, the ESLint rules, the ADRs — without
breaking an invariant or loosening security without a paper trail. The other runbooks in this
folder are for operating a _deployment_; this one is for operating the _template itself_.

> **New here? Read `docs/ARCHITECTURE.md` first** (#27) — the mental model of the eight
> harness systems and how they connect. This runbook is the _procedures_; that doc is the _map_ that
> makes them make sense.

Ground rule, above every procedure below: **a change that loosens an autonomous-agent boundary
(what a hook denies, what a rule catches, what a permission allows) is security-sensitive — it
needs an explicit human decision on the record (an ADR or a `docs/findings-register.md` line),
never a silent edit.** Tightening is cheaper than loosening; when in doubt, tighten.

## Before you touch anything

- [ ] Read `CLAUDE.md` (the constitution) + the matching `docs/rules/*.md` for the area
      (a PreToolUse hook also surfaces the rule file when you edit a matching path).
- [ ] Check the **Ask-before** list in `CLAUDE.md`. If the file is on it
      (`lib/auth.ts`, `lib/api-helpers.ts`, `middleware.ts`, `eslint-rules/**`, `lib/prisma/**`,
      `.claude/settings.json` permissions, the `Role` enum, …), STOP and get explicit operator
      sign-off first, and note it in `docs/findings-register.md`.
- [ ] Work on the branch, never `main` directly when branch protection is on. `/ship` green
      before every push (`npm run ship`).

## Change an ESLint rule (`eslint-rules/**`) — Ask-before

The thirteen `rihal-template/*` rules are the security floor. To change one:

1. [ ] Edit the rule in `eslint-rules/rules/<name>.mjs`.
2. [ ] Update its RuleTester cases in `tests/eslint-rules/rules.test.mjs` (valid AND invalid);
       a rule change with no test change is a red flag.
3. [ ] `npm run test:lint-rules` — the rule's tests must pass.
4. [ ] `npm run ship` — the rule runs at `error` across the repo; fix or justify any new hit.
5. [ ] If you **weakened** the rule (it now catches less): record why in `SECURITY.md §12` +
       get operator sign-off (this is loosening a security gate).
6. [ ] A one-off suppression is a single-line `// eslint-disable-next-line rihal-template/<rule>`;
       if security-related, log it in `SECURITY.md §12`. Never disable a rule repo-wide to dodge it.

## Change a hook (`.claude/hooks/**`) — Ask-before for the security hooks

Hooks gate what the agent reads/runs/writes at tool-time. The two **deny** hooks
(`protect-secrets.mjs`, `dangerous-commands.mjs`) fail **closed** (WS-8/ADR-047).

1. [ ] Edit the hook. Keep the fail-closed catch intact on the security hooks — a guard that
       can't evaluate must block, not allow.
2. [ ] Add/adjust the negative test in `tests/harness/hooks.test.mjs` (deny AND allow cases,
       plus the malformed-stdin fail-closed case).
3. [ ] `npm run test:hooks` — must pass.
4. [ ] If you changed the hook's **matcher** in `.claude/settings.json` (widening what it
       guards is fine; NARROWING what it guards is loosening — get sign-off + a register line).
5. [ ] The semantic backstop under the lexical deny-list is `dangerous-commands.mjs` — extend
       IT for a new dangerous pattern, don't rely on prefix patterns alone.

## Add or change a `/ship` gate (`scripts/ship.mjs`)

1. [ ] Decide the tier: **warm** (`/ship`, DB-free, ~60–90s — a normal push) vs **full**
       (`ship:full`/`SHIP_FULL=1` — +docker/bdd/integration; ADR-061). App/DB-dependent checks
       go in the FULL path (or `/qa`), never the warm loop (it must stay fast — Pillar 1).
2. [ ] A new gate that can't run everywhere must **degrade to WARN**, never a false RED (mirror
       the docker/integration gates: skip-with-note when the infra is absent).
3. [ ] Give it an escape hatch if it can block legitimately: an `*Ack` flag in
       `project.config.json` + an **adjudicated** `docs/findings-register.md` line (the ADR-025
       pattern — never a silent bypass).
4. [ ] `npm run ship` (and `npm run ship:full` if you touched the full path) — green.
5. [ ] Update the gate list below ("Warm `/ship` vs `ship:full`" under § Harness reference).

## Write or supersede an ADR (`docs/decisions/**`)

1. [ ] Use `/adr` (it enforces the MADR template: decision drivers + per-option trade-offs).
       Preflight requires `docs/decisions/ADR-TEMPLATE.md`.
2. [ ] Changing the **ADR-001 locked stack** needs a _superseding_ ADR first — never edit the
       stack and backfill the rationale.
3. [ ] A **quarterly stack-refresh** ADR (ADR-017 track 2) fills the "Platform doctrine sync"
       section (V2-505) — check whether a native platform feature has obsoleted a custom harness
       piece (precedent: V2-105 → ADR-057), and record keep/thin/retire per area.
4. [ ] Cross-link related ADRs in `## Related`; mark the superseded ADR's status.

## Widen `.claude/settings.json` permissions — Ask-before (security-sensitive)

1. [ ] Widening `permissions.allow` (or shrinking `permissions.deny`) lets an autonomous agent
       run more without a human — **stop, get explicit operator sign-off**, and record it in
       `docs/findings-register.md` (V2-107).
2. [ ] Prefer extending the semantic `dangerous-commands.mjs` backstop over broadening a prefix
       allow.
3. [ ] `npm run test:hooks` still green.

## Add a dependency

1. [ ] Runtime dep > 50 KB minified → Ask-before (needs an ADR or a `/scale-up` recipe).
2. [ ] Any new capability under `lib/**`, `components/shared/**`, `scripts/**` → do the
       build-vs-buy scan and record a `docs/build-vs-buy-ledger.md` entry with a `Considered:`
       line (the gate denies the new file until one exists).
3. [ ] `npm run ship` — knip must see it used; `npm audit` gate must stay green (High+).

## After any harness change

- [ ] `npm run ship` green (the active gate).
- [ ] For a code push touching auth/schemas/API routes/`lib/`, run `/code-review` (pre-push)
      and invoke the `senior-code-reviewer` (post-push) — the two-stage review rail (V2-206).
- [ ] Durable decisions/gotchas → `docs/agent-memory.md` via `/remember`.
- [ ] Land green work on `main` (the fork source-of-truth); never land red.

---

# Harness reference

**Moved here 2026-08-17 (B1)** from `.claude/rules/harness.md`, which had grown to 19.9 KB —
larger than the constitution — and was being loaded into every session (see § Why the rule files
live under `docs/`, below). `docs/rules/harness.md` keeps the **binding rules**; everything below
is the **reference detail** behind them. Nothing was deleted in the split — this is the other half.

## Why the rule files live under `docs/rules/`, not `.claude/rules/`

Claude Code auto-discovers markdown under `.claude/` as project-instruction files and loads it into
**every** session. The six rule files therefore cost ~32.8 KB (~8.2K tokens) of always-on context —
precisely the tax the path-lazy `rules-injection.mjs` hook exists to avoid, so the design was
defeated by its own location. `docs/` is not auto-discovered, so the laziness is now real: a rule
file reaches the model only when a PreToolUse edit matches its frontmatter `globs:`.

The frontmatter contract is unchanged and is the source of truth — add a `docs/rules/*.md` with a
`globs:` header and it participates, no code change. **Do not move these files back under
`.claude/`.** `scripts/context-tax.mjs` fails `--strict` if a `.claude/rules/*.md` file reappears.

## Local ESLint plugin — per-rule rationale (`eslint-rules/`, all thirteen at `error`)

`no-prisma-in-client`, `no-any-cast-on-session`, `no-secret-env-in-console`,
`no-bare-internal-route`, `no-raw-hex-color` (tokens from `app/tokens.css` / `brand.config.ts` /
`chart-palette.ts`; ADR-015), `no-unaudited-bulk-write` (Prisma bulk/upsert on an audited model
bypasses the audit log; ADR-010), `no-raw-sql-unsafe` (`$queryRawUnsafe`/`$executeRawUnsafe` are
unparameterized SQL-injection vectors; OWASP A03), `no-rate-limit-inside-auth` (`withRateLimit`
must compose OUTSIDE the auth wrapper; OWASP A04), `no-restricted-export-column` (a secret-named
field as a `toExcel` column key leaks the raw value into the downloadable `.xlsx`; `SCRUB_FIELDS`
does not cover exports; SECURITY.md §1), `no-prisma-unfiltered-import` (`prismaUnfiltered`
bypasses soft-delete + audit; allowlisted to auth/recycling-bin/maintenance files),
`no-direct-anthropic-sdk` (see `docs/rules/ai.md`; ADR-042), `no-arbitrary-className` (arbitrary
Tailwind values on spacing `p/m/gap/space` + font-size `text-[…px]` drift off the 4px scale / type
scale — the layout sibling of `no-raw-hex-color`; JSX/TSX-scoped; V2-304), `no-literal-jsx-text`
(literal user-facing text in JSX — text nodes + `placeholder`/`title`/`alt` — must route through
next-intl so `messages/*.json` stays the copy chokepoint; `aria-*`/`data-*`/code/pre + dev-pages/
root-boundaries/tests exempt; V2-305). Justified suppressions: single-line disable; if
security-related, log in SECURITY.md §12.

**Adopted (not local): `sonarjs/cognitive-complexity`** (V2-404, closes ADR-034's named
"cognitive-complexity v2" gap). `eslint-plugin-sonarjs`'s cognitive-complexity rule at `error`
on the product surfaces (`app`/`components`/`lib`/`i18n`/`middleware` — not `scripts`/`tests`),
threshold **25** (product max 22 + headroom; ratchet toward the sonarjs default of 15 as the max
drops). Unlike `scanComplexity()` (NEW files only), it catches a per-function regression on an
edit to an existing product file. Not one of the thirteen local rules — an adopted dependency
(`docs/build-vs-buy-ledger.md`, V2-404). Escape: `// eslint-disable-next-line
sonarjs/cognitive-complexity` for a justified one-off.

## Warm `/ship` vs `ship:full` (V2-401, ADR-061)

Two honest tiers — the constitution's "run `/ship` before every push" means the **warm** loop:

- **Warm `/ship`** (`npm run ship`, ~60–80s, DB-free — a normal push): typecheck · lint (incl.
  `sonarjs/cognitive-complexity`, V2-404) · format · contract/component/hook tests · scalability ·
  copy · wave-offs · licenses · tier · session-state · blueprint(+content) · complexity ·
  db-structure · knip · duplication · coverage · skill-check (agentskills.io conformance, V2-503) ·
  build · size-limit · gitleaks · npm-audit · ai-eval.
  (**`session-state`** enforces the Memory-lifecycle rule. It asks whether **`origin/main`**
  tracks `docs/SESSION-HANDOFF.md` / `docs/session-state.json` — not whether the current branch
  does — because the leak happens at MERGE time and nobody runs `/ship` on `main` afterwards. RED
  when `origin/main` tracks them **and** this branch does too; GREEN when this branch removes them
  (it is the remediation), and GREEN in the normal steady state where a working branch tracks them
  and `main` does not. Nothing breaks when they are absent — SessionStart writes a fresh skeleton
  (V2-006).
  **The trap that caused two recurrences:** `git rm --cached <file>` followed by `git add -A` in
  the same commit **re-stages the file** and silently undoes the removal. Commit the paths
  explicitly — `git commit -- docs/SESSION-HANDOFF.md docs/session-state.json` — and verify with
  `git ls-tree -r --name-only origin/main -- docs/session-state.json` after pushing.)
- **`ship:full`** (`npm run ship:full` / `SHIP_FULL=1`; runs in `/deploy`, `/handoff`, CI): warm loop
  **plus** the docker image-build + trivy scan (ADR-030), the BDD traceability gate (ADR-058), the
  **integration** gate — `scripts/test-integration.mjs` runs `tests/integration/*` against a real
  Postgres (an existing `DATABASE_URL`, else an ephemeral `@testcontainers/postgresql` pgvector
  container, else an honest skip; RED only on a genuine failure, degrade-to-WARN with no DB/Docker) —
  and the **SBOM license gate** (`npm run license:sbom`, O5/ADR-051): regenerates the CycloneDX SBOM
  and evaluates IT against the ADR-051 deny set + `license-allowlist.json` (the warm loop's fast
  lock-scan stays warm; this validates the compliance artifact a `/handoff` ships).
  The app-dependent QA slices (`uat:lean`, `visual-regression`) stay with `/qa` / `uat:full` (they
  need a live app + baseline). Warm green never implies the integration round-trips ran — `ship:full`
  (or a dev box with a DB) is where that claim is proven.

`/ship`'s own CI activates at the FIRST of: (a) `/handoff` to a team with Actions, (b) Actions
billing unblocking, (c) a second regular contributor.

## Running db-structure (c) locally — the shadow-DB recipe (2026-07-25)

The db-structure gate's third sub-check (**migrations ↔ schema in sync**) needs a disposable EMPTY
Postgres to replay migrations into. Nothing in the repo sets `SHADOW_DATABASE_URL`, so it degraded
to a WARN on **every run since it was written** — and the first time it actually ran it went RED on
`document_embedding`, the pgvector table that `20260711120000_pgvector_rag` creates and
`schema.prisma` deliberately does not model. No migration could ever have resolved that, so it is
now allowlisted in `checkMigrationsInSync` (`RAW_SQL_TABLES`). Verified BOTH ways: allowlisted drift
passes, an injected column still goes RED — an allowlist that swallows real drift would be worse
than the degraded check it replaced.

To run it for real in this container (**no Docker here** — `make db-up` fails):

```bash
pg_ctlcluster 16 main start                       # native Postgres 16 is preinstalled
# as `sudo -u postgres`: CREATE ROLE app LOGIN PASSWORD '<from .env>' SUPERUSER
#                        createdb -O app app_db && createdb -O app shadow_db
apt-get install -y postgresql-16-pgvector
sudo -u postgres psql -d shadow_db -c "CREATE EXTENSION vector"   # the RAG migration needs it
export SHADOW_DATABASE_URL="<same DSN as DATABASE_URL, database swapped to shadow_db>"
npm run ship                                       # db-structure now PASSES instead of PASS*
```

**Adding another raw-SQL-managed table?** Add it to `RAW_SQL_TABLES` in `scripts/ship.mjs` in the
same commit, or (c) reports drift no migration can fix. **The general lesson:** a check that
degrades quietly when a prerequisite is missing will read as green forever. When you add one, make
the degraded state visibly distinct (`PASS*` + a `note:` here) and actually exercise it once.

## Memory lifecycle — why it is shaped this way

- **In-flight state** → `docs/SESSION-HANDOFF.md` + its data source `docs/session-state.json` —
  **gitignored, local to the machine, never committed anywhere** (changed 2026-07-25). A checkout
  that lacks `session-state.json` gets a fresh skeleton regenerated at SessionStart (V2-006), so
  the status tooling always works.
  The old rule was "committed to the working branch, never merged to `main`" — a state git cannot
  hold, since staying off `main` depended on remembering to strip the files at every merge. It
  failed three times (`4b73206` "D1 recurrence", then twice inside the 2026-07-25 cleanup itself),
  each time shipping the template's own closed-program status to forks as their starting point.
  **Consequence to internalize:** in-flight state now dies with the container.
- **Durable decisions/gotchas/conventions** → `docs/agent-memory.md` — committed, reaches `main`,
  inherited by forks; a ≤30-line digest is surfaced at SessionStart with full sections retrieved on
  demand (V2-102). Add via `/remember`.
- **Stop-hook nuance** (V2-104 senior-review): the `Stop` hook **hard-blocks** turn-end on
  **unpushed commits**; **uncommitted** WIP is only a **warning**, not a block.
- **Auto-plan close call** (V2-104 senior-review): when it's a close call whether work is
  high-blast-radius, default to `EnterPlanMode` **and name the trigger** that justified it (so the
  plan decision is auditable).

## Parallel-by-default — mechanism detail (V2-104)

**Before any multi-part task, decompose it.** If ≥2 units are **write-disjoint** (they touch
non-overlapping file sets), dispatch them as **parallel subagents in a single message** — without
being asked. Parallelism trades tokens for wall-clock, and wall-clock is Pillar 1.

- **File-ownership sets are mandatory.** Each spawned unit gets an explicit, disjoint set of files
  it may write; forbid it from touching any in-flight file. Overlap → serialize those units.
- **Each unit rides its ADR-022 tier** — scout (haiku) for reads, sonnet for implementation, opus
  only for architecture-grade work. The main session orchestrates; routing receipts stay on
  (`routing-receipt.mjs`) so every spawn leaves a trace.
- **Two calibration notes:** (1) **dependency chains don't parallelize** — if unit B needs unit A's
  output, they're sequential, not a wave. (2) **Orchestrator-only during waves** — while a parallel
  wave runs, the main session coordinates and integrates; it doesn't also edit the same files.
- Verify each returned unit (Glob-confirm it wrote its files; read the diff), then integrate and run
  ONE `/ship` over the combined result — not per-unit.
- **Mechanism = `/fan-out` (ADR-057, operator verdict: custom).** The skill is the _enforcement_
  layer over this discipline: it takes a manifest of units + disjoint file-ownership globs, **refuses
  to dispatch** on overlap (`npm run fan-out -- check-overlap`), and after the wave **verifies** every
  changed file landed in exactly one declared set (`npm run fan-out -- verify-scope`). It uses native
  in-message subagent dispatch — it does not replace it. Run from a clean tree so verify-scope is
  truthful. (Native was _recommended_ in ADR-057; the operator chose the enforced skill.)

## The `.claude/` harness — orientation

Skills cover the whole lifecycle — discover them via the skill list; each SKILL.md is
self-documenting. Most used: `/quickstart`, `/scaffold-entity`, `/ship`, `/deploy`, `/qa`,
`/conform`, `/handoff`. The permission allowlist pre-approves npm/prisma/docker/make/non-destructive
git; destructive git ops are deny-listed. The SessionStart hook bootstraps `.env`/deps/client and
warns when the branch is behind `origin/main`. Read access to `.next/`, `node_modules/`,
`generated/` is denied — work from source + `lib/` types, not build artifacts.

The `senior-code-reviewer` is portable to any repo/stack via
`node scripts/install-senior-review.mjs` (ADR-020; `tools/senior-review/README.md`). The full
two-stage protocol lives in `.claude/agents/senior-code-reviewer.md`.

## Command roster

- `npm run dev` · `npm run ship` (the warm gate) · `npm run ship:full` (full gate — +docker/bdd/
  integration; ADR-061) · `npm run test:integration` (testcontainers pgvector suite, V2-401) ·
  `npm run scaffold -- --name <Pascal> --fields '<spec>' [--enums] [--relations] [--writes admin|editor|any]`
- `npm run deploy -- --slug … --display-name … --owner … --admin-email …` ·
  `npm run rebrand -- --slug … --name … --owner …` · `npm run migrate-from -- …`
- `npm test` (contract suite) · `npm run uat` (Playwright; `UAT_BASE_URL` for deployed) ·
  `npm run lint` · `npm run prisma:migrate|:generate|:seed|:studio` · `make db-up` / `db-down`
- `npm run tokens` (per-session/model spend report — ccusage, V2-106) ·
  `npm run context-tax` (always-on context meter; `--strict` is the /ship-gated form)
- `npm run bdd-coverage` (story↔scenario↔step traceability gate — V2-207/ADR-058; dormant until a
  fork writes `tests/features/*.feature`; enforced under `/ship --full`) · `npm run fan-out` (ADR-057)
- `npm run capture` (visual-iteration capture matrix — V2-301) · `npm run copy-check` (source-locale
  copy house-style gate — V2-305) · `npm run visual-regression -- --baseline <dir> --current <dir>`
  (pixel-diff vs a committed baseline — V2-308; QA-time / `uat:full`, NOT warm `/ship`)
- `npm run test:mutation` (StrykerJS mutation testing — V2-405; scoped to the three invariant files
  `lib/prisma/audit-extension.ts` · `lib/api-helpers.ts` · `lib/password.ts` via `stryker.config.json`;
  `/qa`-tier, minutes-not-seconds, NOT warm `/ship`. `npx stryker run --mutate <file>` for one file.)
- Push = deploy: `main` → production, other branches → preview URL.
