# ADR-025 — Tiered enforcement gates: pillars, blueprint, tier, and a blocking Stop hook

**Status:** Accepted
**Date:** 2026-06-25
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The harness shipped a set of *aspirational* controls that did not actually
enforce themselves (operator complaints #9–#14):

- The **Five Pillars** (Speed/Secure/Maintainable/Scalable/High-Quality) were a
  rubric `/ship` and `/qa` were *supposed* to affirm, but nothing failed when a
  pillar concern was waved off and never adjudicated — "acceptable" was a silent
  shrug, not a recorded, reviewed decision (#12).
- `/blueprint` produced a pre-build contract, but only by convention — a real
  feature could be built and shipped with no committed blueprint, so the
  downstream `/qa`/`/uat` coverage matrices had nothing to trace against (#9/#10).
- `project.config.json` `tier` defaulted to `personal` and could stay there
  forever, silently skipping the shared-tier ceremony (`/handoff`, SECURITY.md §9
  compliance, formal findings register, CI activation) even after a tool had
  clearly become a shared, multi-contributor company project (#11).
- The `Stop` hook only *warned* about committed-but-unpushed work. Because a
  fresh remote container clones only what is pushed, unpushed commits are silent
  data loss — exactly the "I built it last session but this session has no record
  of it" failure (#14).

The operator's directive when these were surfaced: **tiered blocking gate · hard
hooks** — make the controls actually block, but scale the ceremony to the project
tier so disposable prototypes are not strangled.

## Decision

Promote the four controls from advisory to **enforced gates**, each with a
deliberate blast-radius limit and an explicit escape hatch:

1. **Pillars-as-gates (wave-off gate).** `/ship` (`scripts/ship.mjs`, phase A)
   hard-fails on any `status: open` wave-off in `docs/findings-register.md`. A
   pillar concern you choose not to fix must be *logged* and then *adjudicated*
   (operator accepts/schedules → `adjudicated(<date>)`) or *fixed*
   (`fixed(<commit>)`) before green. The automatable pillars (Secure via ESLint,
   Scalable via the unbounded-`findMany` scan) already block; this closes the
   loop on the non-automatable ones.

2. **Blocking Stop hook.** `.claude/hooks/session-stop.mjs` emits
   `{"decision":"block", reason}` when commits are unpushed, refusing to end the
   turn until the work is pushed. It is guarded by `stop_hook_active` so it fires
   **at most once per stop attempt** (no infinite stop→block→stop loop), and
   uncommitted working-tree changes remain a **warning**, never a block (a hard
   block there would trap the agent mid-conversation before it can even commit).

3. **Blueprint structural gate.** `/ship` detects a **new feature surface** in the
   diff vs the `origin/main` merge-base — a newly-*added* `app/api/**/route.ts`
   file or a new `prisma/migrations/` directory — and requires a committed
   `docs/blueprints/<feature>.md`. It keys on *added* surface only, so edits to
   existing files (fixes, refactors, dependency bumps) never trip it. **Tiered:**
   `shared` blocks, `personal` only warns.

4. **Tier-vs-reality gate.** `/ship` fails when `tier` is still the `personal`
   default but the repo has **≥2 distinct human contributors** (bots excluded) —
   the same line that activates CI. A multi-contributor tool is shared.

All four are **tiered or escapable**, honoring "tier scales ceremony, never the
security floor": blueprint/tier gates are advisory on `personal` and blocking on
`shared`; the wave-off and Stop-hook gates apply to both (they are floor-level:
losing work and shipping un-adjudicated concerns are wrong at any tier). Escape
hatches are explicit and recorded — `"tierAck"`, `"blueprintAck"`, a committed
blueprint, or an adjudicated register line — never a silent flag.

## Consequences

### Positive
- The controls are now self-enforcing; a green `/ship` *means* the pillars,
  blueprint, and tier invariants hold, not just that someone remembered them.
- Unpushed work can no longer silently evaporate between remote sessions.
- Escapes are auditable (a config key or a register line), so "we skipped this"
  is always a recorded decision.

### Negative
- More ways for `/ship` to go red, and the Stop hook can interrupt an attempt to
  end a turn. New gate code is harness surface that must itself stay correct.
- The contributor-count and added-feature-surface signals are heuristics; they
  can misfire (e.g. a genuinely-personal repo with a second contributor).

### Mitigations
- Every gate is narrow by construction (added surface only; bots excluded;
  `status: open` real-entry regex that ignores the format-doc line) and has a
  one-line escape hatch, so a misfire is a 30-second `*Ack` away.
- The Stop hook's `stop_hook_active` guard bounds it to one block per attempt.
- The gates are unit-checked (regex/contributor/diff logic) and run behind the
  same stop-the-line semantics as the existing `/ship` steps.

## Alternatives considered
1. **Keep them advisory (status quo).** Rejected — the complaints were precisely
   that advice the harness doesn't enforce gets skipped under time pressure.
2. **Block unconditionally, no tiering.** Rejected — would strangle the
   disposable `/quickstart` idea-to-URL flow the template exists to serve.
3. **Require a blueprint for any Ask-before file edit.** Rejected — would block
   every bug fix, refactor, and dependency bump that touches `lib/`/routes; the
   false-positive rate would train operators to disable the gate.
4. **A `PreToolUse` blueprint check** instead of a `/ship` phase. Rejected for
   now — `/ship` already owns the pre-push gate and has the diff context; a
   per-tool-call check is noisier and harder to scope.

## Migration triggers
- If a gate's false-positive rate makes operators reach for the escape hatch
  routinely, tighten the signal or downgrade that gate to a warning.
- If plan-mode leaves a durable artifact, fold a "plan trace" into the blueprint
  gate's satisfied-by set (the handoff's original "no plan-mode trace" idea).
- Revisit the contributor threshold if the commit-identity model changes (e.g.
  all operator work routes through a single bot identity).

## Related
- CLAUDE.md "Five Pillars", "Hard rules", "Project tiers"
- `.claude/skills/ship/SKILL.md` (steps 4c/4d/4e), `scripts/ship.mjs`
- `.claude/skills/blueprint/SKILL.md`, `docs/blueprints/README.md`
- `.claude/hooks/session-stop.mjs`, `docs/findings-register.md`
- ADR-019 (token-thrift harness, handoff durability), ADR-022 (agent memory)
- ADR-026 (native design system) — the other half of the harness-hardening sweep
