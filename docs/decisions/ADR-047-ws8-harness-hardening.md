# ADR-047 — WS-8 harness hardening: fail-closed guards, gate-quartet, role-agents, docker-first deploy

**Status:** Accepted (enterprise pivot, WS-8 governance/harness lane, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-022 (agent memory + model routing), ADR-034 (complexity gate —
the enforcement trio this extends), ADR-036/ADR-042 (AI-agent stack + AI-Quality
pillar — the `ai-eval` gate), ADR-030/ADR-035 (Docker-first), ADR-040 (OTel tracing).

## Context

The v2 enterprise benchmark's WS-8 lane flagged four harness-governance gaps that
each let a class of risk through the existing controls:

1. **Security guard hooks failed OPEN on their own errors.** The PreToolUse guards
   that protect secrets and block dangerous commands (`protect-secrets`,
   `dangerous-commands` under `.claude/hooks/`) treated an internal error (parse
   failure, unexpected input) as "allow." A guard whose _job_ is to deny must not
   become a no-op the moment it throws — a security control that fails open is
   theater. Governance gates (the build-vs-buy / blueprint / complexity deny-hooks)
   are the opposite case: an error there should not wedge the operator out of
   editing, so they stay fail-open by design. The two hook classes need opposite
   failure postures, made explicit.
2. **The enforcement set was described as a trio, but a fourth gate already
   existed.** ADR-034 completed the "enforcement trio" (build-vs-buy → blueprint →
   complexity) governing **code shape**. ADR-036 then shipped the `ai-eval` `/ship`
   phase-B gate governing **AI-endpoint output quality** (dormant until `AI_API_KEY`
   - fixtures, but wired at `scripts/ship.mjs`). The prose lagged the reality: the
     governance set is a **quartet**, and calling it a trio hid the fourth gate.
3. **No named specialist agents for the two hardest review lanes.** The harness had
   `scout` (haiku investigation) and `senior-code-reviewer` (sonnet post-push
   breadth), but no design-level **security-architecture** reviewer and no
   **operational-readiness** reviewer — the two lanes the enterprise benchmark most
   wanted, and the two that map cleanly onto ADR-022's opus/sonnet tiers.
4. **`/deploy` did not state the Docker readiness gate.** ADR-030 made the image a
   mandatory build artifact gated at `/deploy`, but the deploy skill's prose never
   said so, leaving the image build implicit at exactly the moment it should be
   verified.

## Decision

Adopt four aligned changes, each extending an existing pattern rather than adding a
new mechanism:

1. **Fail-closed security guards; fail-open governance gates.** The `protect-secrets`
   and `dangerous-commands` PreToolUse hooks **deny on their own error** (a guard
   that cannot evaluate a request denies it — fail-closed). The governance deny-hooks
   (build-vs-buy, blueprint) stay **fail-open** so a harness bug never wedges the
   operator out of legitimate edits. The two postures are now an explicit, documented
   contract. _(The hook code edits land under `.claude/hooks/` via the WS-8 hooks
   lane; this ADR is the decision of record for that posture.)_
2. **Gate-trio → gate-quartet.** The enforcement set is documented as the
   **quartet**: build-vs-buy → blueprint → complexity → **ai-eval**. The first three
   govern code shape (PreToolUse deny + `/ship` RED); the fourth (`ai-eval`,
   ADR-036/042) governs AI-endpoint output quality as a wired `/ship` phase-B gate —
   dormant (exit 0) on any non-AI fork, enforced (RED) once `AI_API_KEY` + fixtures
   exist. No new `/ship` phase; `ai-eval` was already wired. CLAUDE.md, the affected
   blueprint prose, and a grouping comment in `scripts/ship.mjs` are updated to say
   quartet; the historical ADR-034/ADR-036 text is left intact (ADRs are superseded,
   not rewritten — this ADR records the transition).
3. **Two specialist role-agents, tiered per ADR-022.** Add
   `.claude/agents/security-architect.md` (**opus** — design-level threat modeling /
   trust-boundary / data-classification review; the hardest tier per ADR-022, where
   depth beats speed) and `.claude/agents/sre.md` (**sonnet** — operational-readiness
   / observability / rate-limit / deploy-rollback / runbook review). Both are
   read-only (`Read, Grep, Glob, Bash`), mirror the existing agent `.md` frontmatter
   shape, and stay in their lane: security-architect reviews the DESIGN (not
   line-level code — that is `senior-code-reviewer` / `/code-review` — and not
   build-time positive patterns — that is `stack-advisor`); sre reviews operability.
4. **Docker-first `/deploy` alignment.** The deploy skill states that image
   build + verification (`make docker-build` / `/ship --full`) is part of deploy
   readiness (ADR-030), while **Vercel + Neon stays the default deploy target**
   (ADR-006) and the Vercel build is byte-for-byte untouched. Escape hatch:
   `"dockerAck"` + an adjudicated findings-register line.

## Consequences

### Positive

- A security guard that errors now **denies** instead of silently waving the action
  through — the fail-open hole in the two secret/command guards is closed, with the
  opposite (fail-open) posture kept for governance gates so the operator is never
  wedged out.
- The fourth governance gate (`ai-eval`) is **visible** in the prose it was missing
  from; the quartet framing makes the AI-output gate a first-class peer of the three
  code-shape gates.
- Two named specialists cover the security-architecture and operational-readiness
  lanes at the right ADR-022 tier, discoverable via `.claude/agents/*.md`.
- `/deploy` readiness now names the image gate it always implied.

### Negative / risk

- Fail-closed guards can block a legitimate action if the guard itself is buggy —
  mitigated by scoping fail-closed to the two _security_ guards only (governance
  gates stay fail-open) and by the guards being simple, well-tested deny logic.
- Two more agents to keep lane-correct; mitigated by explicit "not X's lane"
  boundaries in each agent's prompt.
- The quartet prose must stay in sync with the wired gates; mitigated by the
  `scripts/ship.mjs` grouping comment co-located with the gate.

## Alternatives considered

- **Leave the guards fail-open, rely on review.** Rejected: a security control that
  no-ops on error provides false assurance; fail-closed is the only honest posture
  for a deny-guard.
- **Make ALL hooks fail-closed for consistency.** Rejected: a fail-closed governance
  gate would let a harness bug wedge the operator out of ordinary edits — the wrong
  trade for a non-security advisory gate. Opposite postures by hook class is the
  correct nuance.
- **Fold ai-eval into the "trio" silently without renaming.** Rejected: the fourth
  gate deserves to be named; hiding it under "trio" is the documentation drift this
  ADR fixes.
- **One generalist reviewer agent instead of two.** Rejected: security-architecture
  (opus) and operational-readiness (sonnet) are different tiers and different lenses
  per ADR-022; collapsing them either overpays (sonnet work on opus) or underserves
  (threat modeling on the mid tier).
- **Rewrite ADR-034/ADR-036 to say quartet.** Rejected: ADRs are historical records
  superseded by later ADRs, not edited in place (the same convention CLAUDE.md
  applies to the locked stack). This ADR is that superseding record.

## References

- ADR-022 — agent memory + model routing (the opus/sonnet tiering the two role-agents
  follow); `docs/token-policy.md` tier-routing table.
- ADR-034 — complexity-budget gate (the "enforcement trio" this extends to a quartet).
- ADR-036 / ADR-042 — AI-agent stack + the AI-Quality pillar; the `ai-eval` `/ship`
  gate (`scripts/ship.mjs`, phase B) that is the fourth governance gate.
- ADR-030 / ADR-035 — Docker as a mandatory build artifact; ADR-006 (Vercel + Neon
  default deploy target).
- ADR-040 — OpenTelemetry tracing (`lib/observability` / `withSpan`), the observability
  surface the `sre` agent reviews.
- CLAUDE.md — Hard rules (enforcement quartet), Harness section (specialist agents).
- Blueprint: `docs/blueprints/enterprise-ws8-harness.md`.
