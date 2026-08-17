---
globs: .claude/**, eslint-rules/**, scripts/**, tests/**, Makefile
title: Harness — gates, ESLint roster, agents, token policy, commands
---

# Harness rules (binding)

Loaded lazily when you touch the harness (`.claude/**`, `eslint-rules/**`, `scripts/**`, tests).
**This file is the binding rules only.** The reference material behind them — the full ESLint
rationale, the warm-vs-full gate tables, the shadow-DB recipe, the memory-lifecycle history, the
parallel-by-default mechanism detail, the full command list — lives in
**`docs/runbooks/maintainer.md` § Harness reference**. Read that when you need the detail; nothing
was deleted in the split.

## Agents & tier routing (ADR-022)

Route work to the tier that fits (`docs/ARCHITECTURE.md`): **scout** (haiku — read-only
investigation) · **senior-code-reviewer** (sonnet — post-push breadth) · **security-architect**
(opus — threat model / trust boundaries / data classification) · **sre** (sonnet — operational
readiness). Read access to `.next/`, `node_modules/`, `generated/` is denied — work from source.

## Review rail — two-stage, binding (ADR-020, V2-206)

Both the pre-push `/code-review` diff gate and the post-push `senior-code-reviewer` run **STAGE 1
spec-compliance BEFORE STAGE 2 code-quality**. Stage 1 maps every changed file to a covering
blueprint `Scope:`: a changed gated file (`app/api/**/route.ts`, `app/**/page.tsx`, `lib/**`)
outside every covering Scope is a **Stage-1 finding** (High), as is diff behavior contradicting a
story/AC. A flawless-but-wrong change fails Stage 1 and never reaches the quality lenses. Stage 1
leads the report (or an explicit "Stage 1 clean" line). Preferred runner is CI
(`.github/workflows/senior-review.yml`, dormant); when CI is off, invoke the agent in-session
before calling the work done. (Build-time note: the React Compiler Babel pass, ADR-048, adds ~10s
to `/ship`'s build.)

## Token thrift (binding; policy: `docs/ARCHITECTURE.md`, ADR-019)

- Delegate repo-wide searches to **scout**; don't read >5 files inline for orientation.
  `docs/REPO-MAP.md` answers "where is X" for free.
- Concise output; targeted edits over rewrites; read a file once unless it changed.
- When compacting, preserve: modified-file list, last `/ship` status, open findings, operator goal.
- Long session → `/handoff-session` at the next milestone; repetitive N-file jobs → `/batch`.
- Durable knowledge → `docs/agent-memory.md` via `/remember` (ADR-022).

## Parallel-by-default (binding, V2-104)

Decompose every multi-part task. ≥2 **write-disjoint** units → dispatch as parallel subagents in a
**single message**, unprompted. **File-ownership sets are mandatory** (explicit, disjoint; overlap →
serialize). Dependency chains do NOT parallelize. The main session is **orchestrator-only** during a
wave. Verify each returned unit, then run **ONE** `/ship` over the combined result. Enforcement
mechanism is `/fan-out` (ADR-057): `check-overlap` refuses to dispatch on overlap, `verify-scope`
confirms every changed file landed in exactly one declared set.

## Memory lifecycle (binding)

- **In-flight state** (`docs/SESSION-HANDOFF.md`, `docs/session-state.json`) is **gitignored, local
  to the machine, never committed anywhere.** It dies with the container by design; SessionStart
  regenerates a skeleton (V2-006). Anything worth keeping goes to `docs/agent-memory.md` — that is
  the answer to "but I need this next session", not a commit of these files.
- The `Stop` hook **hard-blocks** turn-end on **unpushed commits**; uncommitted WIP is a warning only.
- Close call on blast radius → default to `EnterPlanMode` **and name the trigger** that justified it.

## The enforcement quartet — mechanism (CLAUDE.md states the rule)

Each gate **denies/REDs** until its committed adjudication artifact exists; recording the artifact
IS the scan, not a bypass. Artifacts: build-vs-buy → a `docs/build-vs-buy-ledger.md` entry whose
`Scope:` covers the file AND carries a `Considered:` line naming ≥1 real alternative (scan step 0 is
`docs/oss-catalog.md`); blueprint → a covering `docs/blueprints/<feature>.md` `Scope:`; complexity →
`complexityAck` + an adjudicated `docs/findings-register.md` line. Hooks: `build-vs-buy-gate.mjs`,
`blueprint-gate.mjs`, and `bash-write-gate.mjs` (Bash writes to gated paths are covered too).

## Project tiers — mechanism

`/ship` enforces tier-vs-reality: ≥2 distinct human contributors (the same line that activates CI)
while `project.config.json` `"tier"` is still the `personal` default **fails**. Fix with
`"tier": "shared"`, or record `"tierAck": "personal"` if it is genuinely still personal.

## ESLint floor (`eslint-rules/`, thirteen rules, all at `error`)

`no-prisma-in-client` · `no-any-cast-on-session` · `no-secret-env-in-console` ·
`no-bare-internal-route` · `no-raw-hex-color` (ADR-015) · `no-unaudited-bulk-write` (ADR-010) ·
`no-raw-sql-unsafe` · `no-rate-limit-inside-auth` · `no-restricted-export-column` ·
`no-prisma-unfiltered-import` · `no-direct-anthropic-sdk` (ADR-042) · `no-arbitrary-className` ·
`no-literal-jsx-text`. Plus the adopted `sonarjs/cognitive-complexity` at `error` (threshold 25) on
the product surfaces. Justified suppression = a **single-line** disable; if security-related, log it
in SECURITY.md §12. Per-rule rationale: `docs/runbooks/maintainer.md` § Harness reference.

## Gates & commands

`npm run ship` is the **warm** loop (~60–80s, DB-free) — what "run `/ship` before every push" means.
`npm run ship:full` adds docker+trivy, BDD traceability, integration-vs-real-Postgres, and the SBOM
license gate; it runs in `/deploy`, `/handoff`, CI. **Warm green never implies the integration
round-trips ran.** Full gate lists and the whole `npm run …` roster are in
`docs/runbooks/maintainer.md` § Harness reference.

## Known traps (don't "fix")

- After large route deletions a stale `.next` breaks typecheck with TS2307 — `npm run ship` auto-heals.
- The rule files live in `docs/rules/`, NOT `.claude/`: anything under `.claude/` is auto-loaded into
  every session, which would make these lazy files an always-on tax. Do not move them back.

## Ask before (harness surface)

Touching `eslint-rules/`; disabling any `rihal-template/*` rule beyond a single-line disable;
suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12); changing the ADR-001
locked stack (write a superseding ADR first); **editing `.claude/settings.json`'s
`permissions.allow`/`permissions.deny` arrays** — widening what an autonomous agent may run without
a human in the loop is security-sensitive (V2-107): get explicit operator sign-off and note it in
`docs/findings-register.md`. The semantic backstop under the lexical deny-list is
`dangerous-commands.mjs` (fail-closed) — extend IT, don't rely on prefix patterns alone.
