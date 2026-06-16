# ADR-020 — Mandatory post-push senior code review (cross-stack)

**Status:** Accepted
**Date:** 2026-06-15
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-007 (solo rail), the `/ship` gate, the native `/code-review`

## Context

A full external review of the template (filed as issues #28–#35) surfaced eight
real defects: a soft-delete extension that filtered some read operations but not
`findUniqueOrThrow`/`findFirstOrThrow`/`aggregate`/`groupBy`/nested includes
(#33); a password reset that never invalidated existing JWT sessions (#28);
reset-link `Host`-header trust (#29); Excel formula injection in the export
helper (#30); shell-string interpolation in `migrate-from` (#31); un-GC'd
verification tokens (#32); dependency advisories (#35); and DX/architecture
smells (#34).

The instructive part was **why the existing gates missed them**. They cluster
into four classes that a fast, pre-push, **diff-scoped** review and a typechecker
cannot see by construction:

1. **Cross-cutting invariant completeness** — an invariant covered on the changed
   path but not all paths (#33, #28). The files involved hadn't changed in many
   commits, so a diff review never re-opened them.
2. **Adversarial / output-side trust boundaries** — injection on the way *out*
   and at non-obvious boundaries (#30 formula injection, #29 Host trust, #31
   shell). Input validation was strong; output encoding and trust-boundary
   reasoning were not.
3. **Operational / time-varying state** — advisories accrue after green CI (#35);
   ephemeral rows accumulate without GC (#32).
4. **Architecture / maintainability** (#34).

The gap is **scope and stance** (whole-change + adversarial), not a missing
tool. Notably, these issues *were* caught — by a deliberate whole-repo review.

## Decision

Add a **mandatory, async, post-push "senior code review"** that owns exactly
those four classes, layered on top of (never replacing) the pre-push gates.

- **Review ladder:** `/ship` (build·lint·test·secrets·audit) and `/code-review`
  (fast DIFF gate) stay **pre-push, blocking**. `senior-code-reviewer` runs
  **post-push, async, advisory** — it comments, it never blocks the push, so it
  adds **zero latency** to the dev loop. This division is why adding a fifth
  reviewer does not cause delay or redundancy: each owns a distinct scope.
- **Artifacts** (all stack-agnostic):
  - `.claude/agents/senior-code-reviewer.md` — the reviewer (protocol built
    around the four classes above; reads `CLAUDE.md`/`AGENTS.md`/`SECURITY.md`
    when present so it enforces the project's own invariants).
  - `.github/workflows/senior-review.yml` — async CI gate; **dormant** (manual
    trigger) until `ANTHROPIC_API_KEY` + triggers are set, matching the other
    workflows on the free plan.
  - `AGENTS.md` mandate block + `CLAUDE.md` standing instruction.
- **Cross-stack enforcement.** The mandate is required for **every** project,
  including non-Next.js repos that can't receive a template sync. The portable
  unit ships in `tools/senior-review/` with an installer:
  `node scripts/install-senior-review.mjs --target <repo>` drops the agent,
  workflow, and `AGENTS.md` mandate into any repo. Same-stack forks also receive
  the agent + installer automatically via `/sync-from-template` (OWNED layers).

## Consequences

- **Positive:** the four blind-spot classes now have an owner; the policy is
  portable and self-describing; the async stance means no added push latency; the
  reviewer enforces each repo's documented hard rules, not just generic OWASP.
- **Costs / limits:** CI activation needs paid Actions + an API key (dormant
  until then; the in-session agent fallback covers the gap). The reviewer is
  advisory — findings still require the operator to act. A generic reviewer would
  have caught only the OWASP/architecture subset; the template-aware protocol is
  what reaches the invariant-specific findings (#33, #28).
- **Follow-up:** the eight findings are fixed in the same change as this ADR; run
  a full audit with the new reviewer once it lands (see the session report).
