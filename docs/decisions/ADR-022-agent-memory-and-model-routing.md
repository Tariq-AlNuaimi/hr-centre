# ADR-022 — Cross-session agent memory + model-routing policy

**Status:** Accepted
**Date:** 2026-06-20
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context
Multi-agent "meta-harness" tools (notably `ruvnet/ruflo`, formerly Claude Flow)
market two genuinely useful ideas: **shared memory that persists across sessions**
(so decisions made in one session are reusable in the next) and **cheaper-model
routing** (send low-stakes work to a cheaper model). A June 2026 research pass
evaluated adopting ruflo itself and rejected it: its headline numbers (~75% cost
savings, 84.8% SWE-bench) are self-reported and absent from any public leaderboard;
an independent audit found its "token optimizer" uses a hardcoded baseline and
fabricated percentages while the tool *adds* ~15–25k tokens of overhead per
session; past published versions shipped an obfuscated **destructive `preinstall`
script**; its default setup routes code to non-Anthropic providers and runs Claude
with `--dangerously-skip-permissions`. Every one of those collides with this
template's hard rules (single Claude provider, no secret/Restricted egress, the
Ask-before surface, `/ship`-before-push). See the chat research report for full
citations.

What the template already has: tiered subagents (`scout` = haiku for read-only
exploration), a transient `docs/SESSION-HANDOFF.md` carrier for *in-flight* state
(working-branch only, never merged to `main`), and `docs/token-policy.md` +
ADR-019 documenting model tiering as operator habit. What it lacks: a **durable**
store of long-lived knowledge (decisions, gotchas, conventions) that accumulates
across sessions and — because forks are generated from `main` — propagates to
every fork, plus an explicit routing tier table rather than scattered guidance.

## Decision
Adopt the two *ideas*, not the tool, using the lightest on-template mechanism.

1. **Cross-session agent memory = a committed Markdown file, `docs/agent-memory.md`.**
   Durable, tracked, and **landed on `main`** (the opposite of `SESSION-HANDOFF.md`,
   which is transient working-branch scratch). It holds three append-only,
   one-line-per-entry sections — *Durable decisions*, *Gotchas & landmines*,
   *Conventions discovered* — under a stated curation rule: keep it bounded
   (~150 lines), promote stable items into CLAUDE.md / an ADR and prune the rest.
   The `SessionStart` hook surfaces it into context (whole file if within budget,
   else the file's head — first ~60 lines, newest-first by convention — plus a
   pointer to read the rest), fail-open like the existing drift check. Writes happen via a new `/remember` skill and via `/handoff-session`
   promoting its "Decisions" section. No daemon, no external store, no vector DB,
   no added network egress.

2. **Model routing = a documented tier table** added to `docs/token-policy.md`
   (haiku → search/orientation/repetitive codemods; sonnet → review breadth &
   moderate edits; opus/fable → architecture, ambiguous/high-blast-radius,
   security-sensitive), with subagent `model:` frontmatter as the enforcement
   point and a one-line pointer in CLAUDE.md. Deliberately **no auto-router** —
   ruflo's fabricated optimizer is the cautionary tale; honest policy + frontmatter
   beats a metric with no measurement behind it.

## Consequences

### Positive
- Cross-session continuity for durable knowledge with ~zero infra, fully
  auditable in git, and inherited by every fork at fork time.
- Stays entirely inside the template's security model: single provider, no
  egress, no permission bypass, gated by `/ship` like everything else.
- Routing guidance becomes a referenceable table instead of folklore.

### Negative
- Memory quality depends on curation discipline; an un-pruned file bloats the
  session-start context it is meant to economize.
- No semantic recall — it's a human-readable log, not a vector search.
- Routing remains advisory (operator/subagent-driven), not automatic.

### Mitigations
- Hard size budget enforced at the surfacing step (recent-section fallback over
  the budget) and a curation rule in the file header.
- `/handoff-session` auto-promotion lowers the discipline cost (memory accrues at
  natural session boundaries, not only on manual `/remember`).
- If semantic recall is ever needed, the migration trigger below points to a
  vetted local MCP memory server behind its own ADR — not ruflo.

## Alternatives considered
1. **Adopt ruflo (or another multi-agent meta-harness) directly** — rejected:
   unverified benchmarks, destructive-preinstall history, off-Anthropic egress,
   `--dangerously-skip-permissions`, single-maintainer alpha churn. Violates the
   hard rules and the locked stack (ADR-001).
2. **Local MCP memory server (OpenMemory / mem0)** — more powerful (semantic
   recall) but needs Docker + a new data-egress/trust posture; over-built for the
   prototype rail today. Held as the documented upgrade path.
3. **Prisma-backed in-repo memory table** (audited, soft-deleted) — fully inside
   the security model but a `/scale-up`-scale project; disproportionate for
   capturing decisions/gotchas.
4. **Build an automatic token-optimizing router** — rejected on principle: this
   is exactly the unmeasurable "theater" the research flagged in ruflo.

## Migration triggers
Revisit if: curated Markdown proves insufficient (operators want semantic search
across a large memory) → evaluate a **local-only** MCP memory server behind a new
ADR; or memory needs per-entity/audited structure → a Prisma-backed store via
`/scale-up`; or routing-by-hand demonstrably wastes budget at scale → reconsider
(carefully) a measured router with real token accounting.

## Related
- ADR-001 — locked stack (single Claude provider; superseding ADR required to change)
- ADR-019 — token-thrift harness (scout/haiku tiering, handoff, REPO-MAP)
- ADR-020 — mandatory senior code review
- `docs/token-policy.md` — model-routing tier table lives here
- `docs/agent-memory.md` — the memory file this ADR introduces
