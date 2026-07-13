# ADR-054 — Harness distribution as a versioned plugin + agent-eval golden-set (who reviews the reviewers)

**Status:** Accepted (2026-07-12, Tariq Al-Naaimi)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-047 (WS-8 harness hardening — the fail-closed guards / gate-quartet / role-agents this builds ON), ADR-022 (agent memory + model-tier routing — the routing this moves from advisory to observed), ADR-036 / ADR-042 (the `ai-eval` gate + AI-Quality pillar this mirrors for harness agents).

## Context

The v2 enterprise benchmark's harness lane (`docs/research/v2/16-skills.md`, `17-agents.md`)
graded our harness **best-in-class on format and depth** but flagged four
governance gaps in how the harness is _distributed, versioned, and self-evaluated_.
ADR-047 hardened the harness's runtime behaviour (fail-closed security guards,
the gate-quartet, two tiered role-agents, docker-first deploy); this ADR is the
distribution/governance layer that sits ON TOP of that hardened harness — it does
not re-open any ADR-047 decision.

The four gaps, each an instance of "the harness governs product code but does not
govern _itself_":

1. **The harness has no distribution layer.** Our 28 skills + 4 agents + hooks live
   loose under `.claude/` with no manifest, no version, and no install channel.
   `anthropics/skills`' `SKILL.md` format IS our authoring convention (nothing to
   migrate), but the 2026 ecosystem shipped a layer above it — the Claude Code
   **plugin** (a versioned git repo bundling skills+agents+hooks+commands, installable
   from a marketplace; `16-skills.md` §1). A fork today pulls harness updates via
   `/sync-from-template`'s path-scoped checkout — a template-specific hack with no
   version pin, no changelog, and no way for a fork to know it is stale beyond a
   hand-maintained version marker.

2. **Scaffold generators are generate-once.** `scaffold-entity` / `scaffold-ai-endpoint`
   stamp on-convention files then walk away. When the template's generated _shape_
   changes (a new audit-wiring step, a changed route skeleton), already-generated
   forks drift with no re-sync path — the same drift `/sync-from-template` wrestles
   with, one layer down. Nx generators and Copier both solve this with an
   update/codemod model + a manifest of what was generated (`16-skills.md` §2).

3. **Nobody reviews the reviewers.** `senior-code-reviewer`, `security-architect`,
   and `sre` review product code, and the `ai-eval` gate (ADR-036/042) scores a
   fork's _product_ AI endpoints — but no eval measures whether OUR harness agents
   actually produce good reviews. They are prompt-engineered and confidence-filtered
   (`senior-code-reviewer` reports ≥80 only), which is assurance-by-vibes.
   `17-agents.md` §4 names this the single structurally-missing lens: an agent-eval
   golden-set of past diffs → expected findings, the exact mirror of what `ai-eval`
   does for product AI.

4. **Model-tier routing is advisory.** ADR-022's haiku/sonnet/opus tier table is
   enforced only by each subagent's `model:` frontmatter and the operator's `/model`
   choice — prose, not a gate. Nothing _observes_ that recon actually ran on haiku or
   that opus escalations were logged. `17-agents.md` §5 is deliberate that the fix is
   **not** an auto-router (a metric with no token accounting is theater) but a
   lightweight observed-adherence check.

All four are P1 governance items. They share one shape — a **manifest + a version/
observed-fact** that turns an implicit harness property into a checkable one — so
they are recorded together rather than as four thin ADRs.

## Decision drivers

<!-- the forces that actually decide it -->

- **Forks must upgrade the harness by pinning a version, not by re-running an ad-hoc
  checkout.** `/sync-from-template`'s path-scoped checkout has no pin, no changelog,
  no staleness signal — the load-bearing gap for a deploy-per-tenant, IT-operated
  fleet where many forks trail one template.
- **A gate that governs product code but not the harness that runs the gates is
  half a control.** The `ai-eval` mirror for our own agents is the "who reviews the
  reviewers" completion of the enforcement story.
- **Zero-infra, git-native, honest-over-impressive.** The harness is a handful of
  markdown + `.mjs` files in one repo; the right instruments are a manifest, a
  golden-set, and an observed receipt — not an agent registry, an auto-router, or an
  eval platform (all over-buy per `17-agents.md`).
- **Do not fork our opinionated model.** Superpowers/Backstage/Nx are _technique_
  sources; adopting their methodology wholesale would fork the gate model ADR-047
  just hardened.
- **This ADR is the decision of record; implementation is a later wave.** No `.claude/`
  changes land here.

## Considered options

### Packaging / update channel

#### Option P1 — Versioned Claude Code plugin manifest (chosen)

Bundle `.claude/` (skills + agents + hooks + commands) as a versioned Claude Code
plugin: a `plugin.json`/marketplace manifest carrying a semantic version + changelog,
published to a private/internal marketplace at `/handoff`; forks pin a version and
`plugin install`/upgrade instead of path-checkout. `/sync-from-template` is retained
as the transitional fallback for pre-plugin forks (and for the mixed-file REVIEW
layers a plugin install won't touch — `lib/`, CLAUDE.md, Ask-before files), then
superseded as the harness-upgrade path.

- Good, because a fork gets a **pinned, versioned** harness with a changelog — it can
  tell it is stale and upgrade deliberately, the primary driver.
- Good, because it is the native 2026 distribution primitive (`16-skills.md` §1) —
  zero adapter, our `SKILL.md` format is already exactly right underneath it.
- Good, because it scales to the fleet: one marketplace entry, N forks pinning
  versions, is the deploy-per-tenant upgrade story.
- Bad, because a plugin install cannot own the **mixed** layers (`lib/`, CLAUDE.md,
  Ask-before files) — those still need the `/sync-from-template` REVIEW diff, so the
  two coexist during migration rather than a clean cutover.
- Bad, because it adds a publish step + version-bump discipline (mitigated by routing
  it through the `@changesets` flow already in the stack).

#### Option P2 — Keep `/sync-from-template` path-checkout as the only channel

- Good, because it exists and works today; no new manifest, no publish step.
- Bad, because there is **no version pin and no changelog** — a fork cannot reason
  about what it is on or what an upgrade contains, which fails the primary driver.
- Bad, because it is template-specific tooling the wider ecosystem doesn't understand;
  a fork can't `plugin install` the harness or discover it in a marketplace.

#### Option P3 — git-subtree (or submodule) of `.claude/`

Vendor the harness as a subtree/submodule pinned to a template commit.

- Good, because it gives a real pin (a commit SHA) with standard git tooling.
- Bad, because subtree/submodule pins are a **SHA, not a semantic version + changelog**
  — no human-legible "what changed / is this a breaking harness bump," and submodules
  are a notorious footgun for non-developer operators (the core audience).
- Bad, because it can't carry the marketplace/discovery affordance a plugin gives, and
  it still can't own the mixed `lib/`/CLAUDE.md layers any better than a checkout.

### Agent-eval (who reviews the reviewers)

#### Option A1 — Golden-set of past diffs → expected findings (chosen)

A fixture set (`tests/agent-evals/*` — mirroring `tests/ai-evals/`) of real past diffs
paired with the findings a good review MUST surface; the harness agents are run over
them in CI and scored (findings-recall against the golden expectations, run via
Promptfoo or a `node:test` judge). Mirrors the `ai-eval` gate (ADR-036/042) exactly,
one layer up: `ai-eval` scores product AI outputs, agent-eval scores harness-agent
outputs. Dormant on a fork with no fixtures (exit 0, so a fork's green is untouched),
enforced where the template maintains its own golden-set.

- Good, because it makes agent quality **measured, not vibed** — the "who reviews the
  reviewers" gap closed with a deterministic, inspectable rubric.
- Good, because it reuses the exact shape a maintainer already knows (`ai-eval`
  fixtures + gate), so it is cheap to author and consistent to run.
- Good, because a golden diff with a _known_ planted defect catches a review agent
  that silently regresses (a prompt/model change that stops finding a class of bug).
- Bad, because a golden-set needs curation + upkeep as the codebase and threat model
  move; a stale set measures the wrong thing (mitigated: version the set, add a
  fixture whenever a review agent misses a real finding — the set grows from actual
  escapes).

#### Option A2 — LLM-judge-only (no golden-set)

Score each agent run with a second Claude call judging the review's quality free-form.

- Good, because zero fixture curation — nothing to maintain up front.
- Bad, because it grades **plausibility, not correctness** — an LLM judge with no
  ground truth can't tell that the reviewer _missed_ a real defect, which is the exact
  failure mode we need to catch. It measures fluency, not recall.
- Bad, because judge + reviewer sharing a model correlates their blind spots — both
  miss the same class of bug and the judge rubber-stamps it.

#### Option A3 — None (status quo: prompt-engineering + confidence filter)

- Good, because zero effort.
- Bad, because it is precisely the ungoverned gap the benchmark flagged — agent
  quality is an unmeasured promise, and a silent regression in a review agent ships
  undetected. Fails the "govern the harness itself" driver.

### Model-tier routing enforcement

Chosen: a lightweight **observed routing-adherence check** (a session-receipt
aggregation: did recon/bulk work run on haiku? are opus escalations logged?) that
turns ADR-022 from advisory prose into an observed fact — **not** an auto-router
(RouteLLM/NotDiamond are over-buy for 3 tiers + a handful of agents, and add a metric
ADR-022 itself calls theater without token accounting). ADR-022 keeps its static-tier
stance; this only adds the adherence observation.

## Decision

Adopt four aligned changes, each a **manifest + version/observed-fact** on an existing
harness property, layered on the ADR-047-hardened harness:

1. **Package the harness as a versioned Claude Code plugin.** Add a
   `plugin.json`/marketplace manifest (semantic version + changelog) bundling the
   `.claude/` skills + agents + hooks + commands; publish to a private/internal
   marketplace at `/handoff`. Forks pin + upgrade a version instead of path-checkout.
   `/sync-from-template` is retained transitionally for pre-plugin forks and for the
   **mixed** REVIEW layers a plugin install must not auto-overwrite (`lib/`, CLAUDE.md,
   Ask-before files), then superseded as the harness-upgrade path. (Option P1.)

2. **Scaffold generators gain an update/codemod mode + a manifest.** `scaffold-entity`
   and `scaffold-ai-endpoint` (and the `sync-from-template` path) record a manifest of
   what they generated + at which template version, and gain a re-sync/codemod mode
   that re-applies template-shape changes to already-generated forks instead of a
   manual diff — the Nx/Copier update model (`16-skills.md` §2). The bespoke `.mjs`
   generators are KEPT (they encode audit/soft-delete/RBAC/`SCRUB_FIELDS` invariants a
   generic engine cannot); only the update-after-generate weakness is closed.

3. **Agent-eval golden-set (`tests/agent-evals/*`).** A fixture set of past diffs →
   expected reviewer findings scores `senior-code-reviewer` / `security-architect` /
   `sre` on findings-recall, run in CI via Promptfoo or a `node:test` judge — the exact
   mirror of the `ai-eval` gate (ADR-036/042) for harness agents. Dormant (exit 0) with
   no fixtures so a fork's green is untouched; enforced where a golden-set exists.
   (Option A1.)

4. **Observed routing-adherence check.** A lightweight session-receipt aggregation
   observes ADR-022 tier adherence (recon on haiku, opus escalations logged), turning
   the advisory tier table into an observed fact. No auto-router; ADR-022's static
   stance is unchanged (this is the adherence-check amendment it anticipated). Also
   serves as a **billing** control post the June-2026 Agent-SDK credit split
   (`17-agents.md` §2) — "delegate down" is now a cost discipline, not just a quality one.

The primary driver — a fork must upgrade by pinning a version — tips packaging to the
plugin (P1); the "govern the harness itself" driver tips agent-eval to the golden-set
(A1). This ADR records the decisions; the `.claude/` implementation is a later wave.

## Consequences

### Positive

- A fork can **pin and version** the harness with a changelog and a staleness signal —
  `plugin install`/upgrade replaces the ad-hoc path-checkout as the harness-upgrade path.
- Template-shape changes **re-apply to already-generated forks** via the generator
  update/codemod mode + manifest, instead of silently drifting.
- Harness-agent quality becomes **measured** (findings-recall against a golden-set),
  closing the "who reviews the reviewers" gap and completing the eval story:
  `ai-eval` governs product AI, agent-eval governs the review agents.
- Model-tier routing becomes an **observed fact**, doubling as a cost control under the
  Agent-SDK credit split — advisory prose is now checkable.
- The whole set reuses shapes maintainers already know (`@changesets` versioning,
  `ai-eval` fixtures + gate), so upkeep rides existing muscle memory.

### Negative

- A plugin install cannot own the **mixed** layers (`lib/`, CLAUDE.md, Ask-before
  files) — those still need `/sync-from-template`'s REVIEW diff, so two upgrade
  mechanisms coexist during the migration window rather than a clean cutover.
- Version-bump + publish discipline is new maintainer overhead on every harness change.
- A golden-set is **curation debt**: a stale set measures the wrong threat model, and a
  thin set gives false confidence in review coverage.
- The generator manifest adds a small artifact every scaffold run must keep truthful, or
  the re-sync codemod reasons from a wrong picture.
- More moving parts to keep in sync between the prose (ADR-022 tiers) and the observed
  receipt.

### Mitigations

- **Coexistence, not cutover:** scope the plugin to the clean skills/agents/hooks/
  commands layers; leave mixed layers to `/sync-from-template`'s REVIEW diff — the two
  are complementary by design, and `/sync-from-template` is deprecated only for the
  harness-upgrade role once forks are on the plugin.
- **Route versioning through `@changesets`** (already in the stack) so the publish step
  is the existing release flow, not a new one.
- **Grow the golden-set from real escapes:** add a fixture whenever a review agent
  misses a finding in the wild, and version the set — it tracks the actual threat model
  instead of a snapshot. Score on **recall of known-planted findings** (ground truth),
  not LLM-judged plausibility (why A2 was rejected).
- **Dormant-by-default gates:** agent-eval and the adherence check exit 0 with no
  fixtures/receipt, so a fork's green is untouched until the template maintains them —
  same posture as `ai-eval` (ADR-036) and the fail-open governance gates (ADR-047).

## Alternatives considered

See **Considered options** above. In short: `/sync-from-template`-only (no version pin
or changelog — fails the primary driver) and git-subtree (SHA pin, no semantic
version/changelog, submodule footgun for non-dev operators) were rejected for packaging;
LLM-judge-only (grades plausibility not recall; correlated blind spots) and none
(the ungoverned status quo) were rejected for agent-eval; an auto-router
(RouteLLM/NotDiamond) was rejected for routing as over-buy for 3 tiers and a metric
ADR-022 calls theater — the observed-adherence check is the honest hardening.

## Migration triggers

Revisit this decision when any of these fire:

- **A fork multiplies harness agents/skills** (writes its own beyond the template set)
  — the flat `.claude/*.md` + generated index may need real agent-registry semantics
  (versioned frontmatter + `AGENT-REGISTRY.md`; `17-agents.md` §3), and the plugin
  version boundary needs to account for fork-local additions.
- **The fleet grows past a handful of tenant repos** — a private marketplace + a
  fleet/scorecard view (Backstage-style; `16-skills.md` §3) becomes worth the infra the
  single-repo plugin defers.
- **A review agent regresses undetected in production** (a real defect a golden diff
  should have caught escapes) — raise the agent-eval gate from dormant to a required
  status check, and backfill the fixture.
- **Token/credit spend on `/qa` fan-out becomes a budget line** — promote the
  routing-adherence receipt from observed-only to a soft `/ship` gate.
- **`/sync-from-template` is fully retired** — once all live forks are on the plugin and
  the mixed-layer REVIEW diff has a plugin-native equivalent, drop the transitional
  path.
- **The plugin/marketplace format changes upstream** (Anthropic revs the plugin spec) —
  re-pin the manifest schema.

## Related

- ADR-047 — WS-8 harness hardening (fail-closed guards, gate-quartet, role-agents,
  docker-first deploy); this ADR is the distribution/governance layer ON TOP of that
  hardened harness.
- ADR-022 — agent memory + model-tier routing; this moves the tier table from advisory
  to observed (the adherence-check amendment ADR-022 anticipated). `docs/token-policy.md`
  tier-routing table + the Agent-SDK credit-split note.
- ADR-036 / ADR-042 — the `ai-eval` gate + AI-Quality pillar; the agent-eval golden-set
  is the exact mirror, one layer up (product AI → harness agents).
- `docs/research/v2/16-skills.md` — §1 (harness as versioned plugin, supersedes
  `/sync-from-template` upgrade path), §2 (generators gain update/codemod mode + manifest).
- `docs/research/v2/17-agents.md` — §3 (registry/versioning), §4 (agent-eval golden-set,
  "who reviews the reviewers"), §5 (routing-adherence check, keep static tiers).
- `.claude/skills/sync-from-template/SKILL.md` — the transitional/mixed-layer upgrade
  path the plugin supersedes for the harness role.

## Amendment (2026-07-13) — v1 shipped: private posture, 2 golden seeds, observe-only receipts; marketplace/public + enforcement deferred

Code-wave item 7 landed the first implementation wave (blueprint:
`docs/blueprints/harness-plugin-agent-eval.md`; operator-approved defaults recorded there):

1. **Plugin manifest, PRIVATE/internal posture** — `.claude/plugin.json` v0.1.0
   (name/version/description/changelog pointer). Exists for versioning + `/handoff`
   portability, NOT distribution; no marketplace publish, no install channel yet.
   Version bumps ride the existing `@changesets` flow (docs note only — no CI wiring).
2. **Generator manifest (manifest half only)** — `scripts/lib/generated-manifest.mjs`
   upserts a `docs/generated-manifest.json` entry (generator, name, files/patched,
   harnessVersion, date) at the end of every real `scaffold-entity` /
   `scaffold-ai-endpoint` run. The re-sync/codemod mode that consumes it is deferred.
3. **Agent-eval golden-set, seeded from 2 REAL escapes** — `tests/agent-evals/`
   (`oidc-deactivation-bypass` from the WS-6 SCIM account-linking [High];
   `docker-postinstall-deps-stage` from the item-3 Docker postinstall [Critical]) as
   synthetic minimal diffs + `expected-findings.json` ground truth, scored on
   findings-recall by `scripts/agent-eval.mjs` (`npm run agent-eval`) — DORMANT
   (exit 0) without `AI_API_KEY`, mirroring `ai-eval`, and deliberately NOT a `/ship`
   phase (observe-only v1).
4. **Routing-adherence receipts, observe-only** — a `PostToolUse(Task)` hook
   (`.claude/hooks/routing-receipt.mjs`, bound additively in `.claude/settings.json`)
   appends JSONL rows to the gitignored `.claude/state/routing-receipts.jsonl`;
   `npm run routing-report` summarizes tier usage vs the ADR-022 table. No enforcement.

Deferred to the migration triggers above: public/marketplace publishing + a real
`plugin install` channel, the generator codemod mode, promoting agent-eval to a
required check, and promoting the routing receipt to a soft `/ship` gate.
