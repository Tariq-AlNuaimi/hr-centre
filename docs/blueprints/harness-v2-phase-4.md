# Blueprint — HARNESS-V2 Phase 4: "Verify what was waived"

Scope: CLAUDE.md, .claude/rules/harness.md, .claude/hooks/protect-secrets.mjs, .claude/settings.json, .claude/skills/audit/**, eslint.config.mjs, knip.json, .gitignore, stryker.config.json, package.json, scripts/ship.mjs, scripts/test-integration.mjs, scripts/license-allowlist.json, middleware.ts, i18n/**, tests/integration/**, tests/contracts/**, tests/harness/**, tests/eslint-rules/**, lib/password.ts, lib/ai/rag.ts, lib/ai/embeddings.ts, prisma/migrations/**, SECURITY.md, docs/decisions/**, docs/findings-register.md, docs/build-vs-buy-ledger.md, docs/HARNESS-V2-EVIDENCE.md, docs/blueprints/harness-v2-phase-4.md, .github/workflows/**, Makefile

Track: **Full** · Program: harness-v2 · Phase: 4 of 5 · Branch `claude/harness-v2-kickoff-yhid26`

Feature parity: n/a — this is the PROGRAM blueprint for a harness phase, not a product feature; it names capability items (V2-401…409), not a benchmark matrix.

## Problem & outcome

Phases 0–3 built and tightened the gates. But several claims are still **waived, not
verified**: the integration/Neon path degrades to a warn without a DB; pgvector is
migrated but never round-tripped; the coverage floor is unmeasured; ADR-034 left a
cognitive-complexity v2 gap; `protect-secrets` over-claims its Write coverage; and two
debt items (antd type-shim, bcryptjs) have no sunset. Phase 4 **closes the verify loop**:
turn each waved-off "trust me" into a machine-checked "here's the evidence," and split the
gate into an honest **warm `/ship` (fast, DB-free)** vs **`ship:full` (integration +
BDD/UAT + visual-regression)** so the constitution states exactly what each green means.

Outcome: the things Phases 0–3 said were true are now **proven** — an ephemeral-container
integration run, a real embedding round-trip, an enforced coverage floor, a
cognitive-complexity gate, an honest secrets matcher, and dated sunsets on the last debt.

## Market scan / build-vs-buy (per-item; recorded in `docs/build-vs-buy-ledger.md`)

- **V2-401** adopt `@testcontainers/postgresql` (the standard ephemeral-DB harness) on a
  pgvector image — dev-dependency; ADR + ledger.
- **V2-404** adopt `eslint-plugin-sonarjs` for `cognitive-complexity` (closes ADR-034's
  named v2 gap) — the OSS standard vs a hand-built AST metric; ledger.
- **V2-405 [P]** adopt `@stryker-mutator/core` (command runner) scoped to the three
  invariant files — mutation testing is not something to hand-roll; ledger, `/qa`-tier.
- **V2-407 [P]** adopt `osv-scanner` + `trivy` binaries (self-install pattern like
  gitleaks/semgrep) into `/audit`; evaluate `anthropics/claude-code-security-review` for
  the dormant CI slot; ledger.
- **V2-403 / V2-406 / V2-408 / V2-409** are BUILD/in-repo (node coverage flag, contract
  tests, hook matcher, doc annotations) — no dependency.

## Tier

`personal` (matches `project.config.json`). Phase 4 adds gates/tests/deps — it does not
touch the security floor. New dev-dependencies are QA/verify tooling (no runtime bundle).

## Stories

- **US4.1 (operator):** As the operator, I want the integration/Neon path proven against an
  ephemeral container, and a clear warm-vs-full green, so "it works with a DB" isn't a
  warn. (V2-401)
- **US4.2 (operator):** As the operator, I want pgvector proven end-to-end (embed → `<=>`
  query → HNSW plan), so the RAG seam is real, and the two wave-offs can be adjudicated
  fixed. (V2-402)
- **US4.3 (agent):** As the agent, I want an enforced coverage floor + a
  cognitive-complexity gate, so correctness/maintainability regressions red the build, not
  a reviewer's memory. (V2-403, V2-404)
- **US4.4 (agent):** As the agent, I want the SECURITY.md §15 holes (soft-delete extension,
  middleware routing) covered by invariant unit tests, and `protect-secrets`'s scope made
  honest. (V2-406, V2-408)
- **US4.5 (operator):** As the operator, I want local security fallbacks (osv/trivy) in
  `/audit` and dated sunsets on the last debt (antd shim, bcryptjs), so nothing rots
  silently. (V2-407, V2-409)

## Scenarios (happy / worst per gate item)

- **Coverage floor (V2-403).** Happy: `/ship` prints a coverage check at/above the recorded
  baseline. Worst: a synthetic deletion dropping coverage below the floor reds `/ship`.
- **Cognitive complexity (V2-404).** Happy: the repo lints green at the tuned threshold.
  Worst: a planted deeply-nested function exceeds the threshold and fails lint.
- **pgvector (V2-402).** Happy: a test writes an embedding, runs a `<=>` nearest-neighbor
  query, and asserts an HNSW plan. Worst: a dimension mismatch (the 1024-model trap) is
  caught with a clear error.
- **Integration / ship:full (V2-401).** Happy: `test:integration` is green against an
  ephemeral pgvector container; `ship:full` = warm `/ship` + integration + BDD/UAT-lean +
  visual-regression. Worst: run without Docker → the integration gate reports "needs a
  container/DB" honestly (it does not silently pass).
- **protect-secrets honesty (V2-408).** Happy: `.env.example` edits stay allowed. Worst: a
  write of real secret material into a tracked file is denied (if extended) — or the
  over-claim is corrected + SECURITY.md §17 records the gap.

## Architecture

- **The warm/full split.** `scripts/ship.mjs` stays the fast DB-free warm loop; a new
  `ship:full` (npm script + `SHIP_FULL` path) chains warm `/ship` → `test:integration`
  (testcontainers) → `bdd-coverage`/`uat:lean` → `visual-regression`. CLAUDE.md +
  `.claude/rules/harness.md` state exactly what warm green vs full green includes.
- **Integration harness.** `tests/integration/**` spins an ephemeral `@testcontainers/
postgresql` (pgvector image), applies migrations, and runs the round-trips (pgvector,
  audit, soft-delete). Guarded to skip-with-notice when no Docker/DB is reachable.
- **Coverage floor.** `--experimental-test-coverage` + a line threshold in `/ship` phase A,
  baseline recorded, ratchet note ADR-034-style.
- **Complexity gate.** `eslint-plugin-sonarjs` `cognitive-complexity` + `max-lines` on the
  product surfaces, threshold = current max + headroom; existing violations register-waived
  or refactored.
- **Invariant tests + secrets honesty.** `tests/contracts/**` for the §15 holes;
  `protect-secrets.mjs` extended (or its comment corrected + SECURITY.md §17).

## Open questions (operator input wanted before the heavy build)

- **[CONSTRAINT] V2-401 needs Docker — this build container has none** (native Postgres was
  the Phase-3 workaround, agent-memory 2026-07-17). The testcontainers wiring + `ship:full`
  script can be built and unit-verified here, but the actual ephemeral-container
  `test:integration` run can only be demonstrated where Docker is available (like the
  ADR-030 docker-image gate). Options: (a) build + wire it now, mark the container-run
  acceptance as "verified where Docker present" + a register line; (b) defer V2-401 to a
  Docker-capable environment. Default: (a).
- **[ASK] V2-402 wave-off adjudication.** The round-trip test proves pgvector works, but
  flipping the two related `docs/findings-register.md` wave-offs to `fixed(<commit>)` is an
  **operator adjudication** (the executor never self-adjudicates a register line). I'll do
  the verification + propose the flip; the operator confirms.
- **V2-404 threshold** (cognitive-complexity) — tune to the current codebase max + headroom;
  the exact number surfaces once measured.
- **Order:** the demonstrable, dependency-light items (V2-403 coverage floor, V2-402
  pgvector on native Postgres, V2-406 invariant tests, V2-408 secrets honesty, V2-409 debt
  sunset) land first; the dep-adopting / Docker-gated items (V2-401, V2-404, V2-405, V2-407)
  follow with their ledger/ADR entries.

## Amendments

- **2026-07-17 (senior-review Stage-1 fix).** The original `Scope:` line narrated V2-406's
  middleware work in **US4.4** ("the SECURITY.md §15 holes … middleware routing … covered by
  invariant unit tests") but did not list the files it produced, so a Scope-vs-diff trace flagged
  `middleware.ts` (rewrite) and `i18n/route-decision.ts` (new) as uncovered surface. The middleware
  touch was operator-approved ("Extract + unit-test", `docs/HARNESS-V2-EVIDENCE.md`) — this is a
  contract-hygiene fix, not a new authorization. Scope widened to add `middleware.ts`, `i18n/**`,
  and the other files this phase actually touched but hadn't enumerated (`.claude/settings.json`,
  `knip.json`, `.gitignore`, `stryker.config.json`, `scripts/test-integration.mjs`,
  `scripts/license-allowlist.json`, `tests/eslint-rules/**`).
