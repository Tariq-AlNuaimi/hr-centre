# ADR-032 — Build-vs-Buy Enforcement Gate

**Status:** Accepted
**Date:** 2026-07-10
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The operator's recurring, load-bearing complaint about this template: in app-building
sessions the agent **defaults to hand-building every capability from scratch** — it does
not reach for an existing primitive, a library, or a vetted `/scale-up` recipe; it
over-complicates the code; and it skips the reuse scan unless the operator manually
pushes back, session after session. This produces lower-quality, over-engineered apps
and long, expensive nagging sessions.

The root cause is structural, not a knowledge gap. The template already _states_ the
right behavior — "Market benchmark before building. Any brainstorm/requirements pass
starts with a web search of existing products/libraries/starters" and "Maintainable —
reuses existing primitives/services (check `docs/REPO-MAP.md` before writing new)". But
those live as **advisory prose** in CLAUDE.md and as non-blocking `[skill-activation]
Consider…` hints from `skill-activation.mjs` (`skill-rules.json` is explicitly "data,
not enforcement — the hook never blocks"). The model satisfices past advisory guidance
under load. Meanwhile the behaviors that _always_ happen — `/ship`, gitleaks, the ten
ESLint rules, "no unpushed commits" (the `Stop` hook hard-blocks) — are the ones backed
by **hard, harness-executed gates**. Words lose to defaults; gates don't.

This ADR closes that gap for the single highest-leverage behavior: reaching for an
existing solution before hand-building. It is the first of a planned set that promotes
outcome-changing behaviors from advisory to enforced (blueprint-before-build and a
per-feature complexity budget are the intended follow-ups).

## Decision drivers

- **Advisory guidance is skipped under load; only hard gates reliably change behavior.**
  The existing `Stop`/ESLint/gitleaks gates prove the pattern; build-quality behaviors
  never got it.
- **Friction must stay low.** The operator is _also_ frustrated by long pushback loops,
  so the gate must fire only at the true "hand-building from scratch" moment, not on
  ordinary edits — over-gating recreates the pain it's meant to remove.
- **Reuse the existing harness idioms** — PreToolUse deny contract, fail-open guard
  convention, committed decision artifacts (mirrors the `dockerAck`/`tierAck`/findings-
  register adjudication pattern), MADR ADRs.
- **Durable + reviewable.** The decision trail must survive the ephemeral container and
  be inheritable by forks.

## Considered options

### Option 1 — PreToolUse deny gate + committed decision ledger (chosen)

A new `.claude/hooks/build-vs-buy-gate.mjs` (PreToolUse, `Edit|Write|MultiEdit` matcher)
denies creation of a **new** file on the narrow `lib/` capability surface unless
`docs/build-vs-buy-ledger.md` holds an entry whose `Scope:` glob covers the path.

- Good, because a `permissionDecision: "deny"` is a hard checkpoint the model cannot
  satisfice past — the enforcement the operator has been supplying by hand.
- Good, because recording the decision is not a bypass; it _is_ the required reuse scan,
  captured as a durable, reviewable audit trail.
- Good, because the ledger works for disposable `/quickstart` work that has no full
  committed blueprint, and the narrow trigger (new `lib/` files only, minus validations/
  prisma/tests) keeps false-positive friction near zero.
- Bad, because it adds one new artifact (the ledger) and one convention (`Scope:` globs)
  to learn.

### Option 2 — Advisory `skill-rules.json` entry (recon's suggestion)

Add a fourth rule so `skill-activation.mjs` nudges toward `/blueprint`'s market scan.

- Good, because it is the smallest change and cannot cause a false block.
- Bad, because it produces exactly the non-blocking "Consider…" text the model already
  ignores — it does not change behavior, which is the entire point (fails driver 1).

### Option 3 — Gate against the `/blueprint` Market scan section instead of a ledger

Require a filled `## Market scan` in `docs/blueprints/*.md` covering the file.

- Good, because it reuses an existing artifact with no new file.
- Bad, because matching a blueprint to a specific `lib/` file is fuzzy, and disposable
  `/quickstart` work often has no committed blueprint — so it would over-block or need
  carve-outs (fails driver 2).

## Decision

Adopt **Option 1**. Ship `build-vs-buy-gate.mjs` wired into the existing
`Edit|Write|MultiEdit` PreToolUse block, filtering internally to `Write` of a new file
on the gated `lib/` surface. The pass condition is a `Scope:`-glob match in
`docs/build-vs-buy-ledger.md`; the blueprint/ADR referenced by an entry carries the
prose. Drivers 1 (hard gate beats advice) and 2 (narrow trigger, ledger works for
quickstart) tipped it over Options 2 and 3.

The gate is **fail-open**: on any internal error it stays silent and allows the write,
matching the template's guard-hook convention — a build-quality gate must never brick a
session (unlike a security gate, the cost of a rare miss is low and push-time review
remains a backstop).

## Consequences

### Positive

- Reaching for an existing primitive/library/recipe before hand-building becomes a hard
  step, removing the operator's manual pushback for this behavior.
- Every build-vs-buy call is recorded — a durable audit trail that also feeds the
  Maintainable pillar and code review.
- Establishes the reusable pattern (deny gate + committed adjudication artifact) for the
  planned blueprint-before-build and complexity-budget gates.

### Negative

- Fail-open means a broken/emptied ledger silently disables the gate.
- A genuinely novel capability still requires a ledger entry before the first file — a
  small, deliberate speed bump.
- The `Scope:` glob is coarse; an over-broad glob could unlock more than intended.

### Mitigations

- The hook is small and covered by the verification steps below; the ledger is a plain
  committed file surfaced in review.
- The deny message tells the agent exactly what to write (a `Scope:` glob for the file's
  directory), so satisfying the gate is one short entry, not a ceremony.
- Coarse globs are visible in the ledger and adjudicated in review, same as a findings-
  register wave-off.

## Alternatives considered

1. **Advisory skill-rules entry** — rejected: non-blocking, does not change behavior.
2. **Gate on the blueprint Market scan** — rejected: fuzzy file matching; breaks for
   quickstart work with no committed blueprint.

## Migration triggers

- Revisit if false positives cause real friction (loosen the surface or add a scoped
  ack), or if the follow-up gates (blueprint-before-build, complexity budget) subsume
  the ledger into a single enforcement artifact.
- Revisit the fail-open stance if the gate is ever relied on for a security-relevant
  reuse decision (it is not today).

## Related

- CLAUDE.md — "Market benchmark before building"; Maintainable pillar; Hard rules.
- `.claude/hooks/build-vs-buy-gate.mjs`; `docs/build-vs-buy-ledger.md`.
- ADR-006 (Vercel+Neon rail, PDF/uploads gaps the ledger's seed entry references).
- `.claude/skills/blueprint/SKILL.md` (`## Market scan`); `docs/REPO-MAP.md`.
