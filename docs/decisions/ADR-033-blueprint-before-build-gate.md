# ADR-033 — Blueprint-Before-Build Enforcement Gate

**Status:** Accepted
**Date:** 2026-07-10
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The second load-bearing complaint behind ADR-032: in build sessions the agent jumps
straight to feature code — skipping planning, user stories, worst-path scenarios, and
the clarifying questions that pin down requirements — then fills the gaps with guesses
that turn into rebuilds. The template already _states_ the fix ("Blueprint before
building (the pre-build gate)", "Auto-plan high blast-radius / ambiguous work", the
`/blueprint` skill), but as advisory prose and non-blocking `[skill-activation]` hints
it is skipped under load, exactly as the build-vs-buy guidance was before ADR-032.

ADR-032 established the enforcement pattern (a PreToolUse **deny** gate keyed to a
committed artifact carrying a `Scope:` glob). This ADR applies that same pattern to the
blueprint precondition — the second of the three enforcement gates diagnosed with the
operator (build-vs-buy ✓, blueprint-before-build, complexity budget).

## Decision drivers

- **Advisory loses to the default; only a hard gate reliably forces planning-first.**
- **High signal, low noise.** Gate the two unambiguous "a feature is being built"
  events — a NEW API route and a NEW page — not every edit; over-gating recreates the
  friction it exists to remove.
- **Must not break `/quickstart`.** Disposable work uses the lightweight blueprint
  track, so the gate has to be satisfiable by a minimal stub, not only a full doc.
- **Reuse the ADR-032 idiom** (same `Scope:`-glob mechanism, fail-open guard convention)
  so the enforcement layer stays one coherent, learnable pattern.

## Considered options

### Option 1 — PreToolUse deny gate on new route/page files, keyed to a blueprint `Scope:` (chosen)

`blueprint-gate.mjs` denies a new `app/api/**/route.ts` or `app/**/page.tsx` unless a
`docs/blueprints/*.md` carries a `Scope:` glob covering it. `/blueprint` (both tracks)
now emits that `Scope:` line.

- Good, because it makes a blueprint a hard precondition at the exact feature-build
  moment, reusing the proven ADR-032 mechanism.
- Good, because the lightweight-stub path keeps `/quickstart` flowing through the gate.
- Bad, because it depends on `/blueprint` emitting a `Scope:` line (a small skill change).

### Option 2 — Gate on Prisma model additions instead of routes/pages

Trigger when `schema.prisma` gains a model.

- Good, because a new model is a strong feature signal.
- Bad, because that is an _edit_ to an existing file (not a new-file create), needing
  content-diffing the schema — more complex and outside the clean new-file trigger; and
  schema changes are already Ask-before. Rejected for v1 (routes/pages are the cleaner
  signal).

### Option 3 — Keep it advisory (a stronger `skill-rules.json` nudge)

- Good, because zero false-block risk.
- Bad, because it is the non-blocking hint the model already skips — no behavior change
  (the ADR-032 finding).

## Decision

Adopt **Option 1**. Ship `blueprint-gate.mjs` wired into the existing
`Edit|Write|MultiEdit` PreToolUse block; trigger on new route/page files only; pass on a
blueprint `Scope:` match. Update `.claude/skills/blueprint/SKILL.md` so both tracks write
a `Scope:`-bearing `docs/blueprints/<feature>.md` (full doc or minimal stub). Gate is
**fail-open**, per ADR-032.

The gate enforces that a blueprint _exists and scopes the feature_ — it does not (cannot)
verify the blueprint's substance or that `AskUserQuestion` ran. That substance is owned
by the `/blueprint` skill and by review, the same division of labor as ADR-032: the gate
forces the artifact; the skill and the human own its quality.

## Consequences

### Positive

- Planning-first, user stories, worst-path scenarios, and clarifying questions become a
  hard precondition for feature code — the operator stops supplying that pushback by hand.
- Every feature gets a committed, `Scope:`-anchored blueprint — the contract `/qa` and
  `/uat` already trace against.
- Extends the one enforcement idiom across a second behavior; complexity-budget (gate #3)
  is next on the same pattern.

### Negative

- Depends on `/blueprint` emitting `Scope:`; a blueprint without it won't satisfy the gate.
- Fail-open means a broken blueprints dir silently disables the gate.
- New pages that are pure UI (no real feature) still need a blueprint/stub — a minor
  speed bump, mitigated by the lightweight stub.

### Mitigations

- The skill change + this ADR document the `Scope:` requirement; the deny message tells
  the agent the exact `Scope:` line to add.
- The hook is small and covered by the ADR verification steps; blueprints are reviewed.
- Lightweight stub keeps the quickstart path a few lines, not a ceremony.

## Alternatives considered

1. **Gate on Prisma model additions** — rejected: needs schema content-diffing; not a
   clean new-file trigger; schema is already Ask-before.
2. **Advisory-only nudge** — rejected: non-blocking, no behavior change.

## Migration triggers

- Revisit if new-page false positives cause friction (scope the trigger to routes only,
  or add a `Tier: lightweight` fast-path).
- Fold into a unified enforcement artifact if gate #3 (complexity budget) makes three
  separate hooks redundant.

## Related

- ADR-032 (build-vs-buy gate — the enforcement pattern this reuses).
- `.claude/hooks/blueprint-gate.mjs`; `.claude/skills/blueprint/SKILL.md`.
- CLAUDE.md — "Blueprint before building"; "Auto-plan high blast-radius / ambiguous work".
- `docs/uat-rubric.md` (the blueprint is the coverage contract for `/qa` and `/uat`).
