# ADR-NNN — Title

**Status:** Proposed
**Date:** YYYY-MM-DD
**Decision owner:** <name>
**Reviewers:** —

## Context

<What problem prompted this decision? What constraints apply? What was the state of the world right before this?>

## Decision drivers

<!-- MADR: the forces that actually decide it — rank them. A driver is a concern
     ("must deploy on git push", "solo operator, no CI budget"), not an option. -->

- <driver 1 — the most binding constraint>
- <driver 2>
- <driver 3>

## Considered options

<!-- MADR: every option gets its own Good/Bad, so "why not the alternatives" is
     captured with the same care as "why this". The chosen option appears here too. -->

### Option 1 — <name> (chosen)

<one-line description>
- Good, because <argument>
- Good, because <argument>
- Bad, because <argument>

### Option 2 — <name>

<one-line description>
- Good, because <argument>
- Bad, because <argument>
- Bad, because <argument — ideally tied to a decision driver it fails>

### Option 3 — <name>

<one-line description>
- Good, because <argument>
- Bad, because <argument>

## Decision

<What was chosen, in one or two paragraphs — and which decision driver(s) tipped it.>

## Consequences

### Positive

-

### Negative

-

### Mitigations

-

## Alternatives considered

<!-- Legacy summary section (kept so ADR-001…028 stay conformant). New ADRs:
     put the substance in "Considered options" above and keep this to one
     line per rejected option, or write "See Considered options." -->

1. **<alt 1>** — why rejected.
2. **<alt 2>** — why rejected.

## Migration triggers

<When would we revisit this decision? Concrete signals -- scale milestones, dependency end-of-life, security findings, user-count thresholds.>

## Platform doctrine sync

<!-- QUARTERLY STACK-REFRESH ADRs ONLY (ADR-017 track 2); optional/delete for a regular ADR.
     V2-505. The harness carries a lot of CUSTOM machinery (hooks, ESLint rules, skills,
     the /ship gates). Some of it exists only because the underlying platform — Claude Code,
     Next.js, Prisma, Auth.js — didn't offer a first-class equivalent WHEN it was built. As
     the platform ships native features, a custom piece can become redundant (or worse,
     divergent). The quarterly refresh is the forcing function to look. Precedent: V2-105 —
     native in-message subagent dispatch was evaluated against the hand-built parallel-wave
     idea, and the verdict was recorded in ADR-057 (kept a thin enforced layer, dropped the
     rest). Do the same check here and record the disposition of each item you looked at. -->

Checked the platform's current best-practices / native features against our custom harness
this quarter? For each area, note **keep / thin / retire** + why (cite the native feature):

- **Claude Code** — hooks, subagents/agent-teams, skills, permission model, settings schema,
  output styles: has a native feature obsoleted one of ours (see `.claude/hooks/**`,
  `.claude/agents/**`, `.claude/skills/**`)? <keep/thin/retire + native ref>
- **Next.js** — routing, RSC/caching, middleware, config surface: <disposition>
- **Prisma** — client extensions, query features, migration tooling: <disposition>
- **Auth.js / auth lib** — the ADR-056 freeze posture + any native feature closing a gap: <disposition>
- **Tooling** — ESLint (has a core/plugin rule replaced a local `rihal-template/*` one?), the
  `/ship` gates, the test runner: <disposition>

_No change is a valid outcome — but record that you looked, so "still custom" is a decision,
not an omission. Anything retired needs its own line here + the removal in the same batch._

## Related

-
