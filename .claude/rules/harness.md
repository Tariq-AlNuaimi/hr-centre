---
globs: .claude/**, eslint-rules/**, scripts/**, tests/**, Makefile
title: Harness — gates, ESLint roster, agents, token policy, commands
---

# Harness rules

Loaded when you touch the harness (`.claude/**`, `eslint-rules/**`, `scripts/**`, tests). This is
the full detail behind the constitution's one-line pointers.

## The `.claude/` harness

Skills cover the whole lifecycle — discover them via the skill list; each SKILL.md is
self-documenting. Most used: `/quickstart`, `/scaffold-entity`, `/ship`, `/deploy`, `/qa`,
`/conform`, `/handoff`. Specialist agents live in `.claude/agents/*.md`:

- **scout** (haiku — read-only investigation),
- **senior-code-reviewer** (sonnet — post-push breadth review),
- **security-architect** (opus — security-architecture / threat-model / trust-boundary /
  data-classification design review; ADR-022 hardest tier),
- **sre** (sonnet — operational-readiness / observability / runbook / deploy-rollback review).

Route to the tier that fits the work (ADR-022, `docs/token-policy.md`). The permission allowlist
pre-approves npm/prisma/docker/make/non-destructive git; destructive git ops are deny-listed. The
SessionStart hook bootstraps `.env`/deps/client and warns when the branch is behind `origin/main`.
Read access to `.next/`, `node_modules/`, `generated/` is denied — work from source + `lib/`
types, not build artifacts.

## Review rail — CI path & portability (ADR-020)

The `senior-code-reviewer` runs after every code push. **Preferred path is CI**
(`.github/workflows/senior-review.yml`; non-blocking; dormant until `ANTHROPIC_API_KEY` + triggers
are set); when CI is off, invoke the `senior-code-reviewer` agent on the change before calling the
work done. It is portable to any repo/stack via `node scripts/install-senior-review.mjs` (ADR-020;
`tools/senior-review/README.md`).

**Two-stage review (V2-206).** Both the pre-push `/code-review` diff gate and the post-push
`senior-code-reviewer` run **STAGE 1 spec-compliance BEFORE STAGE 2 code-quality**. Stage 1 maps
every changed file to a covering blueprint `Scope:` and reads its stories/ACs/Delta: a changed
gated file (`app/api/**/route.ts`, `app/**/page.tsx`, `lib/**`) outside every covering Scope is a
**Stage-1 finding** (High — unplanned surface, or a missing/too-narrow blueprint), and diff
behavior that contradicts a story/AC is a Stage-1 finding. A flawless-but-wrong change fails Stage
1; only a Scope-clean change proceeds to the five quality lenses. Stage 1 leads the report (or an
explicit "Stage 1 clean" line). The reviewer agent's `.claude/agents/senior-code-reviewer.md`
carries the full protocol; `/code-review` applies the same order on the pre-push diff.

`/ship`'s own CI activates at the FIRST of: (a) `/handoff` to a team with Actions, (b) Actions
billing unblocking, (c) a second regular contributor. Build-time note: the React Compiler Babel
pass (ADR-048) adds ~10s to `/ship`'s build phase.

## Token thrift (binding; full policy: `docs/token-policy.md`, ADR-019)

- Delegate repo-wide searches/investigations to the **scout** agent (haiku, read-only); don't
  read >5 files inline for orientation. `docs/REPO-MAP.md` answers "where is X" for free.
- Output style: concise; targeted edits over rewrites; no preamble/recap fluff; read a file once
  unless it changed.
- When compacting, always preserve: the modified-file list, last `/ship` status, open findings,
  and the operator's goal.
- When a session gets long, run `/handoff-session` at the next milestone; repetitive
  N-file jobs go through `/batch`, not one long session.
- Durable cross-session knowledge (decisions/gotchas/conventions) lives in `docs/agent-memory.md`
  (a ≤30-line digest surfaced at SessionStart, sections retrieved on demand — V2-102) — add via
  `/remember`; route work by model tier (haiku/sonnet/opus) per the table in
  `docs/token-policy.md` (ADR-022).

## Parallel-by-default (binding — full detail, V2-104)

The constitution states the rule; here is the mechanism. **Before any multi-part task, decompose
it.** If ≥2 units are **write-disjoint** (they touch non-overlapping file sets), dispatch them as
**parallel subagents in a single message** — without being asked. Parallelism trades tokens for
wall-clock, and wall-clock is Pillar 1 (Speed & Velocity).

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

## Memory lifecycle (cross-session durability)

- **In-flight state** → `docs/SESSION-HANDOFF.md` + its data source `docs/session-state.json` —
  both committed to the working branch, **never merged to `main`**, pruned from forks; a
  fork/checkout that lacks `session-state.json` gets a fresh skeleton regenerated at SessionStart
  (V2-006).
- **Durable decisions/gotchas/conventions** → `docs/agent-memory.md` — committed, reaches `main`,
  inherited by forks; a ≤30-line digest is surfaced at SessionStart with full sections retrieved on
  demand (V2-102). Add via `/remember`.
- **Stop-hook nuance** (V2-104 senior-review): the `Stop` hook **hard-blocks** turn-end on
  **unpushed commits**; **uncommitted** WIP is only a **warning**, not a block.
- **Auto-plan close call** (V2-104 senior-review): when it's a close call whether work is
  high-blast-radius, default to `EnterPlanMode` **and name the trigger** that justified it (so the
  plan decision is auditable) — the constitution's auto-plan rule, elaborated.

## The enforcement quartet (Hard gates — full detail)

The constitution names these; here is the full mechanism. All four follow one pattern: a gate +
a committed adjudication artifact.

- **Build-vs-buy (ADR-032; surface widened by V2-309).** Before hand-building a new capability
  under `lib/**`, `components/shared/**`, or `scripts/**` (a reusable primitive / a harness tool is
  a build-vs-buy call too), do the reuse scan — **step 0 is `docs/oss-catalog.md`** (the seeded
  reuse catalog; or `/adopt <capability>`, which reads it), then `docs/REPO-MAP.md` + `lib/` +
  `components/shared/` for an existing primitive, the `/scale-up` recipe table, then a web search —
  and record the decision in `docs/build-vs-buy-ledger.md`: a `Scope:`-glob entry that **must carry
  a `Considered:` line** naming ≥1 real alternative (V2-309 — a bare Scope is a rubber stamp, not a
  scan). The `build-vs-buy-gate.mjs` PreToolUse hook (and the `bash-write-gate.mjs` Bash path)
  **denies** the new file until a Considered-bearing entry covers it. Recording the entry is not a
  bypass, it _is_ the scan.
- **Blueprint (ADR-033).** A new API route (`app/api/**/route.ts`) or page (`app/**/page.tsx`)
  requires a `docs/blueprints/<feature>.md` whose `Scope:` glob covers it — the
  `blueprint-gate.mjs` PreToolUse hook **denies** the new file until one exists. Both `/blueprint`
  tracks write a `Scope:`-bearing file (full doc, or a minimal stub for `/quickstart`). Bash
  writes to gated paths are covered too (`bash-write-gate.mjs`, V2-001).
- **Over-engineering / complexity (ADR-034).** `/ship`'s `complexity` check (phase A) flags any
  NEW product file in the diff that blows the budget (>350 code lines or >40 branch tokens — a
  cyclomatic proxy) and goes **RED** unless waived via `complexityAck` in `project.config.json` +
  an adjudicated `docs/findings-register.md` line.
- **ai-eval (ADR-036/042).** A wired phase-B `/ship` gate scoring AI-endpoint output quality
  against `tests/ai-evals/*.eval.ts` fixtures — dormant (exit 0) until a fork sets `AI_API_KEY`
  AND writes fixtures, then enforced (RED). See `.claude/rules/ai.md`.

## Project tiers (full contract)

`project.config.json` `"tier": "personal" | "shared"` (default personal). Tier scales ceremony,
**never the security floor**: auth wrappers on every route, no leaked secrets, zod at every
boundary, no raw SQL, the thirteen ESLint rules at `error`, audit log ON, `/ship` before every push —
identical for both. `shared` adds: `/handoff` package, SECURITY.md §9 compliance, CI activation at
handoff, formal findings register. `personal` skips those (audit log stays ON). **`/ship` enforces
tier-vs-reality:** if the repo has ≥2 distinct human contributors (the same line that activates CI)
while tier is still the `personal` default, `/ship` fails — a multi-contributor tool is shared and
shouldn't skip the shared-tier ceremony. Fix by setting `"tier": "shared"`, or record
`"tierAck": "personal"` if it's genuinely still personal.

## Local ESLint plugin (`eslint-rules/`, all thirteen at `error`)

`no-prisma-in-client`, `no-any-cast-on-session`, `no-secret-env-in-console`,
`no-bare-internal-route`, `no-raw-hex-color` (tokens from `app/tokens.css` / `brand.config.ts` /
`chart-palette.ts`; ADR-015), `no-unaudited-bulk-write` (Prisma bulk/upsert on an audited model
bypasses the audit log; ADR-010), `no-raw-sql-unsafe` (`$queryRawUnsafe`/`$executeRawUnsafe` are
unparameterized SQL-injection vectors; OWASP A03), `no-rate-limit-inside-auth` (`withRateLimit`
must compose OUTSIDE the auth wrapper; OWASP A04), `no-restricted-export-column` (a secret-named
field as a `toExcel` column key leaks the raw value into the downloadable `.xlsx`; `SCRUB_FIELDS`
does not cover exports; SECURITY.md §1), `no-prisma-unfiltered-import` (`prismaUnfiltered`
bypasses soft-delete + audit; allowlisted to auth/recycling-bin/maintenance files),
`no-direct-anthropic-sdk` (see `.claude/rules/ai.md`; ADR-042), `no-arbitrary-className` (arbitrary
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
  (**`session-state`** enforces the Memory-lifecycle rule above: RED when `docs/SESSION-HANDOFF.md`
  or `docs/session-state.json` is tracked while on `main`. They are branch-only state; they had
  leaked to `main`, so every fork inherited the template's own program status. Nothing breaks when
  they are absent — the SessionStart hook writes a fresh skeleton, V2-006.)
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

## Commands

- `npm run dev` · `npm run ship` (the warm gate) · `npm run ship:full` (full gate — +docker/bdd/
  integration; ADR-061) · `npm run test:integration` (testcontainers pgvector suite, V2-401) ·
  `npm run scaffold -- --name <Pascal> --fields
'<spec>' [--enums] [--relations] [--writes admin|editor|any]`
- `npm run deploy -- --slug … --display-name … --owner … --admin-email …` · `npm run rebrand --
--slug … --name … --owner …` · `npm run migrate-from -- …`
- `npm test` (contract suite) · `npm run uat` (Playwright; `UAT_BASE_URL` for deployed) ·
  `npm run lint` · `npm run prisma:migrate|:generate|:seed|:studio` · `make db-up` / `db-down`
- `npm run tokens` (per-session/model spend report — ccusage, V2-106)
- `npm run bdd-coverage` (story↔scenario↔step traceability gate — V2-207/ADR-058; dormant until a
  fork writes `tests/features/*.feature`; enforced under `/ship --full`) · `npm run fan-out` (ADR-057)
- `npm run capture` (visual-iteration capture matrix — V2-301) · `npm run copy-check` (source-locale
  copy house-style gate — V2-305) · `npm run visual-regression -- --baseline <dir> --current <dir>`
  (pixel-diff vs a committed baseline — V2-308; QA-time / `uat:full`, NOT warm `/ship`)
- `npm run test:mutation` (StrykerJS mutation testing — V2-405; scoped to the three invariant files
  `lib/prisma/audit-extension.ts` · `lib/api-helpers.ts` · `lib/password.ts` via `stryker.config.json`;
  `/qa`-tier, minutes-not-seconds, NOT warm `/ship`. `npx stryker run --mutate <file>` for one file.)
- Push = deploy: `main` → production, other branches → preview URL.

## Known traps (don't "fix")

- After large route deletions, a stale `.next` can break typecheck with TS2307 into `.next/types`
  — `npm run ship` auto-heals this.

## Ask before (harness surface)

Touching `eslint-rules/`; disabling any `rihal-template/*` rule beyond a single-line disable;
suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12); changing the ADR-001
locked stack (write a superseding ADR first); **editing `.claude/settings.json`'s
`permissions.allow`/`permissions.deny` arrays** — widening what an autonomous agent may run without
a human in the loop is a security-sensitive change (V2-107 senior-review): stop and get explicit
operator sign-off, and note it in `docs/findings-register.md`. The semantic backstop under the
lexical deny-list is `dangerous-commands.mjs` (fail-closed; e.g. it denies `git branch` force-delete
in any flag spelling) — extend IT, don't rely on prefix patterns alone.
