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

## Memory lifecycle (cross-session durability)

- **In-flight state** → `docs/SESSION-HANDOFF.md` + its data source `docs/session-state.json` —
  both committed to the working branch, **never merged to `main`**, pruned from forks; a
  fork/checkout that lacks `session-state.json` gets a fresh skeleton regenerated at SessionStart
  (V2-006).
- **Durable decisions/gotchas/conventions** → `docs/agent-memory.md` — committed, reaches `main`,
  inherited by forks; a ≤30-line digest is surfaced at SessionStart with full sections retrieved on
  demand (V2-102). Add via `/remember`.

## The enforcement quartet (Hard gates — full detail)

The constitution names these; here is the full mechanism. All four follow one pattern: a gate +
a committed adjudication artifact.

- **Build-vs-buy (ADR-032).** Before hand-building a new capability under `lib/`, do the reuse
  scan — check `docs/REPO-MAP.md` + `lib/` + `components/shared/` for an existing primitive, the
  `/scale-up` recipe table, then web-search for a library/open-source fit — and record the
  decision in `docs/build-vs-buy-ledger.md` (a `Scope:`-glob entry naming what you considered and
  why build-vs-adopt). The `build-vs-buy-gate.mjs` PreToolUse hook **denies** the new file until
  that entry exists. Recording the entry is not a bypass, it _is_ the scan.
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
boundary, no raw SQL, the eleven ESLint rules at `error`, audit log ON, `/ship` before every push —
identical for both. `shared` adds: `/handoff` package, SECURITY.md §9 compliance, CI activation at
handoff, formal findings register. `personal` skips those (audit log stays ON). **`/ship` enforces
tier-vs-reality:** if the repo has ≥2 distinct human contributors (the same line that activates CI)
while tier is still the `personal` default, `/ship` fails — a multi-contributor tool is shared and
shouldn't skip the shared-tier ceremony. Fix by setting `"tier": "shared"`, or record
`"tierAck": "personal"` if it's genuinely still personal.

## Local ESLint plugin (`eslint-rules/`, all eleven at `error`)

`no-prisma-in-client`, `no-any-cast-on-session`, `no-secret-env-in-console`,
`no-bare-internal-route`, `no-raw-hex-color` (tokens from `app/tokens.css` / `brand.config.ts` /
`chart-palette.ts`; ADR-015), `no-unaudited-bulk-write` (Prisma bulk/upsert on an audited model
bypasses the audit log; ADR-010), `no-raw-sql-unsafe` (`$queryRawUnsafe`/`$executeRawUnsafe` are
unparameterized SQL-injection vectors; OWASP A03), `no-rate-limit-inside-auth` (`withRateLimit`
must compose OUTSIDE the auth wrapper; OWASP A04), `no-restricted-export-column` (a secret-named
field as a `toExcel` column key leaks the raw value into the downloadable `.xlsx`; `SCRUB_FIELDS`
does not cover exports; SECURITY.md §1), `no-prisma-unfiltered-import` (`prismaUnfiltered`
bypasses soft-delete + audit; allowlisted to auth/recycling-bin/maintenance files),
`no-direct-anthropic-sdk` (see `.claude/rules/ai.md`; ADR-042). Justified suppressions: single-line
disable; if security-related, log in SECURITY.md §12.

## Commands

- `npm run dev` · `npm run ship` (the gate) · `npm run scaffold -- --name <Pascal> --fields
'<spec>' [--enums] [--relations] [--writes admin|editor|any]`
- `npm run deploy -- --slug … --display-name … --owner … --admin-email …` · `npm run rebrand --
--slug … --name … --owner …` · `npm run migrate-from -- …`
- `npm test` (contract suite) · `npm run uat` (Playwright; `UAT_BASE_URL` for deployed) ·
  `npm run lint` · `npm run prisma:migrate|:generate|:seed|:studio` · `make db-up` / `db-down`
- `npm run tokens` (per-session/model spend report — ccusage, V2-106)
- Push = deploy: `main` → production, other branches → preview URL.

## Known traps (don't "fix")

- After large route deletions, a stale `.next` can break typecheck with TS2307 into `.next/types`
  — `npm run ship` auto-heals this.

## Ask before (harness surface)

Touching `eslint-rules/`; disabling any `rihal-template/*` rule beyond a single-line disable;
suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12); changing the ADR-001
locked stack (write a superseding ADR first).
