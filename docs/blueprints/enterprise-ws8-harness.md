# Blueprint — Enterprise WS-8: harness hardening (governance, agents, deploy)

Scope: .claude/hooks/**, .claude/agents/**, .claude/skills/deploy/**, scripts/ship.mjs

> Governs the WS-8 governance/harness lane of the enterprise pivot. Decision of
> record: **ADR-047** (WS-8 harness hardening). This is the requirements contract
> `/qa`/`/uat` trace against. WS-8 hardens the harness itself — the hooks, the
> agents, the deploy skill, the `/ship` gate prose — rather than product code, so
> "verification" here means the guards deny/allow correctly and the agents/gates
> are discoverable and correctly framed, not a browser flow. Build-vs-buy: N/A —
> no new `lib/` capability or runtime dependency (harness-config + prose only).

## Problem & outcome

Four harness-governance gaps let a class of risk through the existing controls:
security guard hooks failed OPEN on their own error; the enforcement set was
described as a "trio" while a fourth wired gate (`ai-eval`) already existed; there
was no named specialist agent for security-architecture or operational-readiness
review; and `/deploy` never stated the mandatory Docker image gate. Outcome: the
security guards fail **closed**, governance gates stay fail-open, the gate set is a
documented **quartet**, two tiered role-agents ship, and `/deploy` names the image
gate — each extending an existing pattern, no new mechanism.

## The four lanes

- **Lane A — fail-closed security guards (hooks lane, sibling agent).** The
  `protect-secrets` + `dangerous-commands` PreToolUse guards deny on their own
  internal error (fail-closed); the governance deny-hooks (build-vs-buy, blueprint)
  stay fail-open so a harness bug never wedges the operator out. _(Hook code under
  `.claude/hooks/` is edited by the hooks-lane agent; documented by ADR-047.)_
- **Lane B — gate-trio → gate-quartet.** Document the enforcement set as
  build-vs-buy → blueprint → complexity → **ai-eval** in CLAUDE.md, the affected
  blueprint prose, and a grouping comment in `scripts/ship.mjs`. `ai-eval`
  (ADR-036/042) is already a wired phase-B `/ship` gate — dormant until `AI_API_KEY`
  - `tests/ai-evals/*.eval.ts` fixtures exist, enforced (RED) once they do. No new
    `/ship` phase; historical ADR-034/036 text left intact.
- **Lane C — two specialist role-agents (ADR-022 tiering).**
  `.claude/agents/security-architect.md` (**opus** — threat-model / trust-boundary /
  data-classification DESIGN review) and `.claude/agents/sre.md` (**sonnet** —
  operational-readiness / observability / rate-limit / deploy-rollback / runbook
  review). Both read-only (`Read, Grep, Glob, Bash`), mirroring the existing agent
  `.md` frontmatter shape; each stays in its lane (not `senior-code-reviewer`'s
  line-level review, not `stack-advisor`'s build-time advice). Named in CLAUDE.md.
- **Lane D — docker-first `/deploy`.** The deploy skill states image build +
  verification (`make docker-build` / `/ship --full`, ADR-030) is part of deploy
  readiness, with Vercel + Neon still the default deploy target (ADR-006) and the
  Vercel build byte-for-byte untouched. Escape hatch: `"dockerAck"` + register line.

## Users & stories (EARS; worst path mandatory)

- **US1** — As the **operator**, I want a security guard that errors to DENY, so an
  internal bug in a secret/command guard cannot silently wave a dangerous action
  through.
  - **AC-1.1** — WHEN `protect-secrets` or `dangerous-commands` cannot evaluate a
    request (parse/internal error) THE SYSTEM SHALL deny the action (fail-closed).
  - **AC-1.2 (worst)** — WHEN a governance deny-hook (build-vs-buy, blueprint)
    errors THE SYSTEM SHALL NOT wedge the operator: it stays fail-open, so a harness
    bug never blocks a legitimate edit. The two postures are opposite by hook class.
- **US2** — As a **maintainer reading the harness rules**, I want the enforcement
  set named accurately, so the fourth governance gate isn't hidden under "trio."
  - **AC-2.1** — CLAUDE.md, the affected blueprint prose, and the `ai-eval` grouping
    comment in `scripts/ship.mjs` SHALL describe the set as the **quartet**
    (build-vs-buy → blueprint → complexity → ai-eval), noting `ai-eval` is wired but
    dormant until `AI_API_KEY` + fixtures.
  - **AC-2.2 (worst)** — WHEN a non-AI fork runs `/ship` THE quartet framing SHALL
    NOT change its result: `ai-eval` stays exit-0 (SKIP), so green is untouched.
- **US3** — As a **reviewer**, I want a security-architecture agent and an SRE agent
  at the right model tier, so design-security and operability get a dedicated lens.
  - **AC-3.1** — `.claude/agents/security-architect.md` SHALL declare `model: opus`
    and `.claude/agents/sre.md` SHALL declare `model: sonnet`, both with valid
    frontmatter (`name`/`description`/`tools`/`model`) and read-only tools, citing
    ADR-022 for the tier.
  - **AC-3.2 (worst)** — Neither agent edits or pushes; each explicitly disclaims the
    lanes it does not own (line-level code review; build-time advice).
- **US4** — As the **operator deploying**, I want `/deploy` to name the Docker image
  gate, so image-build readiness is verified, not implicit.
  - **AC-4.1** — The deploy skill SHALL state that `make docker-build` / `/ship
--full` image build + scan is part of deploy readiness (ADR-030), while Vercel +
    Neon stays the default deploy target (ADR-006), with the `"dockerAck"` escape
    hatch named.

## Scenarios (Given/When/Then)

- **US1-happy** — Given a well-formed request, When `protect-secrets` evaluates it,
  Then it allows/denies on the real rule as before (no behavior change on the happy
  path).
- **US1-worst** — Given input that makes `dangerous-commands` throw, When it errors,
  Then the action is denied (fail-closed), not silently allowed.
- **US2-worst** — Given a fork with no `lib/ai` usage and no `AI_API_KEY`, When
  `/ship` runs, Then `ai-eval` reports SKIP and the ship is green — the quartet prose
  changed nothing operationally.
- **US3-happy** — Given the two new agent files, When the harness enumerates
  `.claude/agents/*.md`, Then security-architect (opus) and sre (sonnet) are
  discoverable with valid frontmatter.
- **US4-happy** — Given the deploy skill, When the operator reads it before
  provisioning, Then the Docker readiness section names `make docker-build` and the
  `dockerAck` escape hatch, and confirms Vercel + Neon is still the deploy target.

## Architecture sketch

- **Hooks (Lane A, sibling agent):** `protect-secrets` / `dangerous-commands` gain a
  fail-closed `catch` (deny on error); build-vs-buy / blueprint keep fail-open.
- **`scripts/ship.mjs` (Lane B):** comment-only grouping note at the `ai-eval` gate
  (phase B) — no logic change; `scanAiEval()` already gates.
- **Agents (Lane C):** two new `.md` files under `.claude/agents/`, same frontmatter
  contract as `scout.md` / `senior-code-reviewer.md`; discovery is file-based (no
  `skill-rules.json` entry — that file maps skills, not agents).
- **Deploy skill (Lane D):** a "Docker-first readiness" section before "Steps".
- **CLAUDE.md:** quartet prose in the ADR-034 Hard rule; specialist-agents line +
  tier-routing pointer (ADR-022) in the Harness section.

## The five pillars

- **Speed** — no runtime change; harness-config/prose only; `ai-eval` unchanged.
- **Secure** — the core win: security guards fail **closed** (a deny-guard that
  errors denies); governance gates fail-open by design so the operator is never
  wedged. No secret/PII surface added.
- **Maintainable** — every lane extends an existing pattern (fail-posture on hooks,
  the wired quartet, the agent `.md` shape, the deploy readiness gate); no new
  dependency, no new mechanism.
- **Scalable** — N/A to load; the `sre` agent institutionalizes scalability/rate-limit
  review as a standing lens.
- **High-Quality** — accurate governance prose (quartet not trio), lane-correct
  agents, honest deploy readiness; verified by `node --check scripts/ship.mjs` and
  frontmatter validation of the two agents.

## Tier

`shared` (enterprise pivot). Hardens the harness floor; nothing lowers it.

## Open questions

- [x] Rewrite historical ADR-034/036 to say quartet? → **No** — ADRs are superseded,
      not edited in place (same convention as the locked-stack rule); ADR-047 records
      the trio→quartet transition. Live prose (CLAUDE.md, current blueprints, the
      ship.mjs comment) is updated instead.
- [x] Register the two agents in `skill-rules.json`? → **No** — that file maps skills
      to keywords/paths, not agents; agents are discovered via `.claude/agents/*.md`.
- [x] Make governance gates fail-closed too, for consistency? → **No** — a fail-closed
      advisory gate would wedge the operator on a harness bug; opposite postures by
      hook class (security = closed, governance = open) is the correct nuance (ADR-047).
