Scope: .claude/plugin.json, .claude/hooks/routing-receipt.mjs, scripts/agent-eval.mjs, scripts/routing-report.mjs, scripts/lib/generated-manifest.mjs, tests/agent-evals/**, docs/generated-manifest.json

# Blueprint — Harness-as-plugin + agent-eval golden-set (ADR-054 v1)

> Implements the **first wave** of ADR-054 (harness distribution as a versioned plugin +
> "who reviews the reviewers"): the plugin **manifest**, the generator **manifest**, the
> agent-eval **golden-set seeds + dormant runner**, and **observe-only** routing receipts.
> Distinct from `docs/blueprints/enterprise-ws8-harness.md` (ADR-047 — fail-closed hooks /
> gate-quartet / role-agents), which this layers ON TOP of and does not reopen. No
> `app/**` route or page is added, no `lib/**` touched; the blueprint-gate does not fire
> on these paths — this file is the requirements contract `/qa`/`/uat` trace against.
> Operator approval: 2026-07-13 — "blueprint + build now; resolve open questions with
> recommended defaults and record them here".

## User stories

- **US-1 (fork operator):** as a fork, I can tell WHICH harness version I run
  (`.claude/plugin.json` `version`) and see what changed, instead of guessing from a
  path-checkout — the pin/staleness signal ADR-054's primary driver demands.
- **US-2 (template maintainer):** when a review agent's prompt or model changes, I can
  run `npm run agent-eval` and see whether it STILL finds the two defect classes that
  escaped to (or nearly escaped to) production — measured recall, not vibes.
- **US-3 (template maintainer):** after any scaffold run I can read
  `docs/generated-manifest.json` and know exactly what was generated, by which
  generator, at which harness version — the picture a later re-sync/codemod reasons from.
- **US-4 (operator, cost/quality):** I can run `npm run routing-report` and see whether
  subagent work actually followed the ADR-022 tier table (recon on haiku, review on
  sonnet, security architecture on opus) — an observed fact, zero enforcement.

## Recorded decisions (open questions → defaults, operator-approved 2026-07-13)

1. **Marketplace posture: PRIVATE/internal.** No public publish, no marketplace listing.
   `.claude/plugin.json` exists for **versioning + `/handoff` portability** (an IT team
   receiving the fork can read one manifest for the harness inventory + version), not
   for distribution. A real `plugin install` channel (and the official
   `.claude-plugin/plugin.json` location, if published) is deferred to the ADR-054
   migration trigger "the fleet grows past a handful of tenant repos".
2. **Golden-set seeds: 2 fixtures derived from REAL past findings** documented in
   `docs/SESSION-HANDOFF.md` — synthetic minimal diffs reproducing each **defect class**,
   NOT the original diffs:
   - `oidc-deactivation-bypass` — the WS-6 SCIM/SSO account-linking **[High]**
     (commit `86c010e`: signIn guard keyed on `account.type === "oauth"` only; OIDC
     providers bypassed it, letting a SCIM-off-boarded user re-login).
   - `docker-postinstall-deps-stage` — the item-3 Docker postinstall **[Critical]**
     (`docs/blueprints/docs-site-fumadocs.md` "Docker path": an unguarded `postinstall`
     fails `npm ci` in the Dockerfile `deps` stage, where only `package.json`+lock
     exist, breaking every image build).
     The set grows from real escapes (ADR-054 mitigation), one fixture per escape.
3. **Routing-adherence receipts: append-only JSONL + a `/ship`-independent report;
   observe-only v1, NO enforcement.** A `PostToolUse` hook on `Task`
   (`.claude/hooks/routing-receipt.mjs`) appends one row per subagent spawn to
   `.claude/state/routing-receipts.jsonl` (gitignored dir, same precedent as
   `usage-log.jsonl`); `scripts/routing-report.mjs` summarizes agent/model usage against
   the ADR-022 tier table. Promotion to a soft `/ship` gate waits for ADR-054's
   "token spend becomes a budget line" trigger.

Additional v1 boundaries (recorded so drift is visible):

- **agent-eval is NOT a `/ship` phase.** Observe-only v1: `npm run agent-eval` is
  operator/CI-invoked, dormant (exit 0) without `AI_API_KEY` — exactly the `ai-eval`
  posture pre-ADR-042. Promotion trigger: "a review agent regresses undetected".
- **Generator re-sync/codemod mode is DEFERRED.** v1 ships only the manifest half
  (what was generated, at which harness version); the codemod that re-applies
  template-shape changes is a later wave and consumes this manifest.
- **`@changesets` governs plugin version bumps** (already in the stack:
  `npm run changeset` → `changeset:version`). A harness-visible change adds a changeset;
  the maintainer mirrors the bump into `.claude/plugin.json` `version` at release. No CI
  wiring in v1 — the manifest + discipline note is the deliverable.

## Happy path

1. Maintainer edits a hook → adds a changeset → bumps `.claude/plugin.json` 0.1.0→0.2.0
   at release. A fork comparing its manifest to the template's sees it is stale.
2. `npm run scaffold -- --name Task ...` → files written → one entry upserted into
   `docs/generated-manifest.json` (`generator`, `name`, `files`, `patched`,
   `harnessVersion`, `date`). Re-running for the same entity updates its entry, no dupes.
3. Maintainer sets `AI_API_KEY`, runs `npm run agent-eval` → the runner prompts a
   reviewer (via `@/lib/ai`, never `new Anthropic`) over each fixture's diff+context and
   PASSes when every expected finding's keyword groups appear in the review. A prompt
   regression that stops finding the OIDC bypass → RED exit 1.
4. A session spawns `scout` for recon → the hook appends a receipt →
   `npm run routing-report` shows recon rode the cheap tier.

## Worst paths

- **No `AI_API_KEY` (pristine template, every fork):** `agent-eval` prints SKIP and
  exits 0 — a fork's green is untouched (mirrors `scripts/ai-eval.mjs` dormancy).
- **Manifest write fails mid-scaffold** (read-only FS, malformed JSON): the generator
  WARNS and completes — the manifest is an observability artifact, never a scaffold
  blocker. A malformed existing manifest is replaced with a fresh valid one.
- **No receipts file / no spawns yet:** `routing-report` prints a note and exits 0.
- **Hook failure:** `routing-receipt.mjs` swallows every error and exits 0 — a receipt
  appender must never brick a turn (same contract as `session-receipt.mjs`). Rows are
  bounded (rotation at 1000) so the JSONL cannot grow unbounded.
- **Reviewer output mentions the right words for the wrong reason:** accepted v1 risk —
  keyword-group recall is a floor, not a rubric; LLM-judged grading was explicitly
  rejected by ADR-054 (Option A2) and richer scoring waits for more fixtures.

## Architecture sketch

```
.claude/plugin.json                     manifest: name/version/description/changelog pointer
.claude/hooks/routing-receipt.mjs       PostToolUse(Task) → append JSONL row (observe-only)
.claude/settings.json                   + one additive PostToolUse binding (matcher "Task")
.claude/state/routing-receipts.jsonl    gitignored, rotated, one row per subagent spawn
scripts/routing-report.mjs              JSONL + agents/*.md frontmatter → tier-usage summary
scripts/agent-eval.mjs                  dormant runner: fixtures × reviewer → keyword recall
scripts/lib/generated-manifest.mjs      recordGeneration() helper (shared by generators)
scripts/scaffold-entity.mjs             + one call at end of real run (not dry-run)
scripts/scaffold-ai-endpoint.mjs        + one call at end of real run (not dry-run)
docs/generated-manifest.json            committed, seeded empty; upserted per scaffold run
tests/agent-evals/<fixture>/            input.diff + context/* + expected-findings.json + README
```

Data flow (agent-eval, live): fixture dir → prompt = reviewer persona (from
`.claude/agents/<agent>.md`, frontmatter stripped) + `input.diff` + `context/*` →
`runAgent()` via `@/lib/ai` (tsx loader, same as `ai-eval.mjs`) → check each expected
finding's `mustMentionAnyOf` groups → PASS/FAIL per fixture → exit 0/1. No raw
completions logged (short miss labels only); no secrets in fixtures.

## Tier

`personal` (template default). No security-floor change: no new route, no auth surface,
no Restricted data; the hook writes only agent-type/model/description-prefix metadata
(no prompt bodies) to a gitignored file.

## Traceability

- ADR-054 decision 1 (plugin) → `.claude/plugin.json` (manifest-only v1; decision 1 above)
- ADR-054 decision 2 (generator manifest) → `scripts/lib/generated-manifest.mjs` +
  `docs/generated-manifest.json` (codemod mode deferred)
- ADR-054 decision 3 (agent-eval) → `tests/agent-evals/**` + `scripts/agent-eval.mjs`
  (dormant; decision 2 above)
- ADR-054 decision 4 (routing adherence) → `routing-receipt.mjs` +
  `scripts/routing-report.mjs` (observe-only; decision 3 above)
