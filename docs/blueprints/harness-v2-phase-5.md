# Blueprint — HARNESS-V2 Phase 5: "Stack & steady state"

Scope: docs/decisions/**, renovate.json, .claude/skills/**, .claude/plugin.json, scripts/skill-standard-check.mjs, scripts/rebrand.mjs, scripts/generate-manifest.mjs, docs/generated-manifest.json, docs/runbooks/**, docs/build-vs-buy-ledger.md, docs/findings-register.md, docs/HARNESS-V2-CLOSEOUT.md, docs/HARNESS-V2-EVIDENCE.md, docs/blueprints/harness-v2-phase-5.md, HARNESS-V2-BACKLOG.md, package.json, .claude/rules/harness.md

Track: **Full** · Program: harness-v2 · Phase: 5 of 5 (final) · Branch `claude/harness-v2-kickoff-yhid26`

Feature parity: n/a — this is the PROGRAM blueprint for the final harness phase, not a product feature; it names capability items (V2-501…507), not a benchmark matrix.

## Problem & outcome

Phases 0–4 built, tightened, and verified the gates. Phase 5 is **steady state**: the
decisions and mechanisms that keep the harness correct and current AFTER the program ends,
plus the program's own closeout. Nothing here adds a product surface; it settles the auth
posture (V2-501), automates dependency currency (V2-502), conforms + future-proofs the
skill/plugin layer (V2-503/504), writes the bus-factor floor (V2-505), makes forks inherit
only what they should (V2-506), and closes the program with an evidenced retro (V2-507).

Outcome: the harness has a recorded auth decision with a revisit rule, a running dependency
bot, standard-conformant skills, a live docs-currency path, a maintainer runbook, a clean
fork doc-payload, and a closeout doc with the three headline deltas — so the next
maintainer (or a fork) inherits a coherent, self-describing system.

## Market scan / build-vs-buy (per-item; recorded in `docs/build-vs-buy-ledger.md`)

- **V2-502 Renovate** — adopt the hosted Renovate GitHub App (config-only, no npm dep) vs
  Dependabot (already referenced in ADR-054/ADR-017) vs hand-rolled `npm outdated` cron.
  Renovate chosen in the backlog for richer grouping/lockfile-maintenance + works while
  Actions are dormant; ledger records it vs Dependabot.
- **V2-504 docs-currency** — adopt the **context7 MCP** (already connected; purpose-built
  live library-doc lookup) wrapped in a thin skill, vs building a fetch-and-cache skill, vs
  leaning on WebSearch. context7 is the reuse win; ledger + a skill that routes stack
  questions through it with a graceful fallback.
- **V2-503 skill standard** — validate against the **agentskills.io open standard** (a spec,
  not a dependency); the validator is a small in-repo script (`scripts/skill-standard-check.mjs`).
- V2-501/505/506/507 are in-repo doc/ADR/manifest/runbook work — no dependency.

## Tier

`personal` (matches `project.config.json`). Phase 5 adds config/docs/skills — it does not
touch the security floor, auth code, or any Ask-before file except `scripts/rebrand.mjs`
(V2-506, a scripts/ file — not on the Ask-before list) and the ADR-056 record (V2-501, a
decision doc). No runtime dependency is added (Renovate is a hosted app + config; context7 is
an already-connected MCP server).

## Stories

- **US5.1 (operator):** As the operator, I want the Better Auth vs stay-frozen decision
  RECORDED with a concrete revisit rule (and, if I choose, a calendar deadline), so the auth
  posture isn't an open question that rots. The migration itself, if chosen, is a separate
  follow-on program — Phase 5 records the decision only. (V2-501, **ASK**)
- **US5.2 (maintainer):** As the maintainer, I want dependency updates to arrive as triaged
  PRs (in-range continuously, majors grouped quarterly, the `next-auth` beta pin respected)
  without me watching npm, so currency doesn't depend on memory. (V2-502)
- **US5.3 (maintainer):** As the maintainer, I want every SKILL.md to conform to the
  agentskills.io standard and the plugin package to be publish-ready (not published), so the
  `.claude/` layer is portable and a future marketplace step is a config flip, not a rewrite.
  (V2-503)
- **US5.4 (agent):** As the agent, I want a docs-currency path that pulls CURRENT stack docs
  before answering version-sensitive questions, so a stale training answer on Next 16 /
  Prisma 7 / Tailwind 4 / Auth.js doesn't ship. (V2-504)
- **US5.5 (maintainer):** As the maintainer, I want a "platform doctrine sync" checklist in
  the quarterly-refresh ADR template and a `maintainer.md` runbook for evolving
  gates/ADRs/hooks safely, so the harness survives a maintainer handoff (the bus-factor
  floor). (V2-505)
- **US5.6 (fork operator):** As a fork operator, I want `/rebrand` to prune template
  DEV-HISTORY docs (not fork-relevant) while keeping fork-inherited docs, so a new project
  ships with a clean, relevant doc payload — never losing template history (moved to an
  archive reference, never deleted from template main). (V2-506)
- **US5.7 (program owner):** As the program owner, I want a closeout doc with the per-phase
  retro, token spend, the three deltas (context tax, warm `/ship` time, gate count), the
  superseded-items map, and the open-items list, so harness-v2 ends evidenced, not just
  stopped. (V2-507)

## Scenarios (happy / worst per item)

- **V2-501.** Happy: an amended/superseding ADR records the operator's choice + revisit rule
  (and deadline if set); `/ship` green. Worst: the decision is left implicit → the item is not
  done (a recorded decision is the whole deliverable).
- **V2-502.** Happy: `renovate.json` validates and its comments map each setting to ADR-017 /
  ADR-056 (the beta pin is excluded from majors). Worst: Renovate would propose bumping the
  frozen `next-auth` beta → the config's `packageRules` must exclude it (assert in a comment +
  a note in the ledger).
- **V2-503.** Happy: `npm run skill-check` reports all 33 skills conformant; `plugin.json`
  updated. Worst: a skill frontmatter is missing a required field → the checker exits non-zero
  and names the file:field (a real gate, not a rubber stamp).
- **V2-504.** Happy: the skill routes a stack question through context7 and a live Prisma 7
  API lookup returns current docs. Worst: context7 unreachable → the skill degrades to a
  documented WebSearch/`docs/recipes.md` fallback, never a stale confident answer.
- **V2-505.** Happy: the ADR template gains a doctrine-sync section and `maintainer.md` is
  committed. Worst: the runbook is vague → it must name the concrete files (eslint-rules/,
  hooks, ADRs) and the safe-change procedure.
- **V2-506.** Happy: the manifest classifies every doc as fork-inherited vs template-dev, and
  a `rebrand --dry-run` prints the prune list. Worst: a fork-relevant doc is mis-classified as
  dev-history → the dry-run surfaces it for review before any prune.
- **V2-507.** Happy: `HARNESS-V2-CLOSEOUT.md` is complete and the evidence manifest has zero
  empty-evidence rows for non-deferred items. Worst: a non-deferred item has no evidence →
  closeout blocks until it does (or it's explicitly deferred with a register line).

## Architecture

- **V2-501** amends ADR-056 (or writes a superseding ADR) with the operator's recorded choice
  - revisit rule; no code change.
- **V2-502** `renovate.json` at repo root, `packageRules` grouping majors + excluding the
  `next-auth` exact pin (ADR-056), `lockFileMaintenance` on, comments mapping to ADR-017.
- **V2-503** `scripts/skill-standard-check.mjs` parses each `SKILL.md` frontmatter and asserts
  the agentskills.io required fields (name, description, and the standard's optional/known
  keys); wired as `npm run skill-check`. `plugin.json` version/metadata refreshed.
- **V2-504** a new skill (`.claude/skills/docs-current/`) whose SKILL.md instructs routing
  version-sensitive stack questions through the context7 MCP (`resolve-library-id` →
  `query-docs`), with a WebSearch / `docs/recipes.md` fallback; demonstrated on one Prisma 7
  API. stack-advisor gains a one-line "check current docs" pointer.
- **V2-505** the quarterly-refresh ADR template gains a "Platform doctrine sync" section
  (cite V2-105 as precedent); `docs/runbooks/maintainer.md` documents the safe-change
  procedure for gates/ADRs/hooks/eslint-rules.
- **V2-506** `docs/generated-manifest.json` (or a sibling `docs/doc-manifest.json`) gains an
  `inheritance` field per doc (`fork` | `template-dev`); `scripts/rebrand.mjs` gains a
  dry-run prune list driven by that classification (MOVE-to-archive semantics, never delete
  from template main).
- **V2-507** `docs/HARNESS-V2-CLOSEOUT.md`: per-phase retros (already in EVIDENCE — summarize
  - link), ccusage spend (`npm run tokens`), the three deltas (context tax via
    `scripts/context-tax.mjs`, warm `/ship` time vs the 90s baseline, gate count then-vs-now),
    the superseded-items map (HARNESS-V2-BACKLOG.md), and the open-items/deferrals list.

## Open questions — RESOLVED (operator, 2026-07-17)

- **[ASK] V2-501 — the auth decision.** **RESOLVED: stay frozen, triggers only.** The operator
  confirms the `next-auth@5.0.0-beta.31` freeze and keeps ADR-056's existing trigger-based revisit
  rule (Auth.js GA slip, a security cliff, Better Auth clearing the Prisma/SSO/SCIM parity bar, or a
  new auth surface forced onto the beta) with **no calendar deadline** — the trigger set is sound and
  a date adds churn without new information. V2-501 amends ADR-056 with this recorded confirmation; no
  migration (that would be a separate follow-on program).
- **[fork] V2-504 — docs-currency mechanism.** **RESOLVED: wrap the context7 MCP + fallback.** The
  skill routes version-sensitive stack questions through the already-connected context7 MCP
  (`resolve-library-id` → `query-docs`) with a WebSearch / `docs/recipes.md` fallback when context7 is
  unreachable. Reuse win, no new dependency.
- **Order:** the self-contained, low-risk items land first (V2-502 Renovate, V2-505 doctrine/
  runbook `[P]`, V2-506 fork manifest `[P]`), then the skill items (V2-503 conformance,
  V2-504 docs-currency), then V2-501 (decision record), and finally V2-507 closeout (must run
  LAST — it inventories every other item's evidence).

## Amendments

_(none yet)_
