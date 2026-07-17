# ADR-034 — Complexity-Budget Enforcement Gate

**Status:** Accepted
**Date:** 2026-07-10
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The third load-bearing complaint behind ADR-032/033: the agent **over-complicates —
sprawling files, needless branching, over-engineered features** — and the operator has
to catch it by hand. The two path-based deny-gates already shipped (ADR-032 build-vs-buy,
ADR-033 blueprint-before-build) fire _before_ code is written and cannot see complexity
that accretes _inside_ the code. "Maintainable" and "High-Quality" are Five-Pillar gates
in prose, but nothing automatable enforced a size/branching budget.

This is the third of the three enforcement gates diagnosed with the operator. Unlike #1/#2
(PreToolUse deny hooks), this one is shaped like the existing `/ship` static gates
(`scalability`, `duplication`) — a diff-scoped check in `scripts/ship.mjs` phase A,
adjudicated through the same findings-register wave-off path every other gate uses.

## Decision drivers

- **Over-engineering is invisible to the path-based gates; it needs a code-shape gate.**
- **Diff-scoped, not whole-repo.** Judge only what THIS change adds, so the gate never
  flags pre-existing files an unrelated change happens to touch.
- **No new dependency.** A complexity analyzer lib would trip the very build-vs-buy gate
  we just shipped; git + node proxies are enough for an MVP (dogfooding ADR-032).
- **Conservative + waivable.** A genuinely large-but-necessary file must be an
  adjudicated wave-off, not a false red — reuse the `ackWaiver` + findings-register path.

## Considered options

### Option 1 — Diff-scoped static gate in `scripts/ship.mjs`, dependency-free (chosen)

`scanComplexity()` flags NEW product files (`app|lib|components|hooks`, `.ts/.tsx`) in the
diff vs `origin/main` that exceed a code-line budget (350) or a branch-token cyclomatic
proxy (40). Breach → RED unless `complexityAck` + an adjudicated register line.

- Good, because it catches the over-engineering the path-based gates can't, at the same
  adjudication path the operator already knows.
- Good, because zero new deps — it dogfoods the build-vs-buy gate.
- Bad, because a token/line proxy is coarser than a real AST cyclomatic metric, and v1
  only covers ADDED files (see below).

### Option 2 — ESLint built-in `complexity` + `max-lines-per-function`

- Good, because it is a real per-function metric with no bespoke code.
- Bad, because it is per-file always-on (not diff-scoped): it would flag pre-existing
  files across the repo, forcing a noisy baseline cleanup or a wall of disables, and it
  fails the "judge only this change" driver. Rejected for v1; reconsider for v2.

### Option 3 — A complexity-analyzer library (`code-complexity`, `plato`)

- Good, because accurate AST metrics.
- Bad, because it adds a runtime/dev dep (>50 KB Ask-before) to do what a proxy does for
  an MVP — and the build-vs-buy gate (ADR-032) would (correctly) demand this ADR justify
  it. Not worth it yet.

## Decision

Adopt **Option 1**. Ship `scanComplexity()` wired into phase A alongside `scalability`/
`blueprint`; conservative thresholds (`CX_FILE_LOC=350`, `CX_BRANCHES=40`); the branch
proxy deliberately excludes bare `?` and `?.` so TS optional params/props don't inflate
it. Waiver via `complexityAck` + adjudicated findings-register line, identical to the
other gates.

**Scope of v1 (explicit):** covers **ADDED** files only. Per-function cyclomatic
complexity of **modified** files is a documented v2 extension — it needs either the
ESLint route (Option 2, once a baseline is clean) or an AST pass, and is deferred rather
than shipped half-done. This limitation is stated so a future session re-promotes it via
`/blueprint` rather than assuming it exists.

## Consequences

### Positive

- A "simple feature became a sprawling file" now blocks `/ship` (RED) instead of shipping
  — the over-complication pushback the operator supplied by hand is automated.
- Completes the enforcement trio (build-vs-buy → blueprint → complexity) on one coherent
  pattern (deny/RED + committed adjudication artifact).
- Zero new deps; the gate itself passes the build-vs-buy gate.

### Negative

- Token/line proxy is coarser than an AST metric; a very dense-but-legitimate new file
  can false-red (mitigated by the waiver).
- v1 misses complexity growth inside modified files.
- Another threshold pair to tune.

### Mitigations

- Thresholds are conservative (baseline: no current new-file offenders) and waivable via
  the standard adjudicated path; the RED message names the exact file + metric.
- v2 scope is documented here, not silently dropped.
- Thresholds live as named constants in `ship.mjs`, easy to tune with a register note.

## Alternatives considered

1. **ESLint `complexity`/`max-lines-per-function`** — rejected for v1: per-file not
   diff-scoped; noisy on the existing tree.
2. **Complexity-analyzer library** — rejected: a new dep for what a proxy does at MVP;
   the build-vs-buy gate would demand this ADR justify it.

## Migration triggers

- Add v2 (modified-file per-function complexity) when over-engineering slips through
  edits to existing files — via ESLint once a baseline is clean, or an AST pass.
  **CLOSED (2026-07-17, V2-404):** the "via ESLint" path shipped — `eslint-plugin-sonarjs`'s
  `sonarjs/cognitive-complexity` is now at `error` on the product surfaces
  (`app`/`components`/`lib`/`i18n`/`middleware`, not `scripts`/`tests`) at threshold **25**
  (current product max 22 + headroom; ratchet toward the sonarjs default of 15 as the max
  drops). Unlike the diff-scoped `scanComplexity()` proxy (NEW files only), this catches a
  per-function regression on an EDIT to an existing file too. Build-vs-buy:
  `docs/build-vs-buy-ledger.md` (V2-404); wiring: `eslint.config.mjs`; test:
  `tests/eslint-rules/cognitive-complexity.test.mjs`.
- Tune thresholds if false reds recur (adjust the constants + a register note).
- Fold the three enforcement gates into a unified layer if maintaining three surfaces
  becomes friction.

## Related

- ADR-032 (build-vs-buy) + ADR-033 (blueprint) — the enforcement trio this completes.
- `scripts/ship.mjs` `scanComplexity()`; the `ackWaiver` + `docs/findings-register.md` path.
- CLAUDE.md — Five Pillars (Maintainable, High-Quality); Hard rules.
