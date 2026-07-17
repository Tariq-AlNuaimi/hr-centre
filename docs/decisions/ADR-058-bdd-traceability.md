# ADR-058 — Story→test traceability via playwright-bdd (machine-verified coverage)

**Status:** Accepted (2026-07-17, Tariq Al-Naaimi — operator signed off on adopting the
`playwright-bdd` runtime). `playwright-bdd` is installed (dev-dependency); `playwright-bdd.config.ts`

- `npm run bdd:gen`/`test:bdd` wire the Gherkin executor; `bddgen` verified generating a Playwright
  spec from the pilot's feature + steps. The **enforced** coverage flip still rides `/ship --full`
  (V2-401, Phase 4); warm `/ship` is unchanged.
  **Date:** 2026-07-17
  **Decision owner:** Tariq Al-Naaimi
  **Reviewers:** —
  **Amends:** ADR-008 (UAT through Playwright — the acceptance loop this adds traceability to) ·
  ADR-016 (website E2E tool). **Relates to:** ADR-033 (blueprint stories — the `USn`/`AC` spine this
  traces against), V2-207, V2-401 (`/ship --full` — where the gate becomes enforced).

## Context

The blueprint gives every feature stable `US<n>` stories with EARS acceptance criteria and
Given/When/Then scenarios (ADR-033). Nothing _mechanically_ checks that each story actually has a
test: `/qa` and `/manual-uat` trace coverage by hand, so a story can ship with no scenario and a
scenario can be written with no runnable steps — the coverage claim is honor-system. Phase 2's exit
criterion is that this becomes machine-verified: **every `USn` maps to a scenario; an unimplemented
scenario is a failing test, not a silent gap.**

`playwright-bdd` turns Gherkin `.feature` files into Playwright tests on the existing runner
(fixtures/tracing from ADR-008 kept) — the concept adopted here. EARS phrasing (the constrained
"WHEN … THE SYSTEM SHALL …" form already in blueprint ACs) is offered as the scenario-writing
standard (was R3) so a `.feature` step reads back to its AC.

## Decision drivers

- **Machine-verified traceability** (the Phase-2 exit criterion) — a story without a scenario, or a
  scenario whose steps have no definition, must go RED, not warn.
- **Reuse the existing runner** — ADR-008's Playwright setup stays; this adds a Gherkin layer, not a
  second test stack.
- **Don't tax warm `/ship`** — traceability is a `/ship --full` gate (V2-401, Phase 4), dormant in
  the warm loop, so the fast green bar is untouched.
- **Solo-operator honesty** — the gate must be a thin, dependency-light checker we own, not a black box.

## Considered options

### Option 1 — playwright-bdd + an owned coverage checker (chosen)

Adopt `playwright-bdd` (dev-dependency) to _execute_ `.feature` files as Playwright tests, and own
`scripts/bdd-coverage.mjs` as the _traceability gate_: it parses blueprint `USn` stories,
`tests/features/*.feature` (`@USn`-tagged scenarios), and the step definitions, and reds on a story
with no scenario, a scenario with no `@US` tag, a dangling `@US` (no such story), or a step with no
matching definition.

- Good, because it satisfies the exact exit criterion with a checker we control (the coverage math
  doesn't depend on the package).
- Good, because Gherkin executes on the existing Playwright runner — one stack.
- Good, because the checker is dependency-free and unit-tested, so the gate is trustworthy.
- Bad, because `playwright-bdd` is a new dev-dependency (ledgered; dev-only, no runtime/bundle cost).

### Option 2 — Custom tag-only lint on plain Playwright specs (no dependency)

Enforce `USn` tags in existing `*.spec.ts` names via a grep-lint; no Gherkin.

- Good, because zero new dependency.
- Bad, because no Given/When/Then structure and no "unimplemented scenario = red" — a tagged empty
  test passes; the coverage guarantee is weaker than the exit criterion asks.

### Option 3 — Defer entirely to Phase 4

- Good, because least work now.
- Bad, because Phase 2's exit criterion (machine-verified coverage) is the whole point of "complete
  the loop"; deferring guts the phase.

## Decision

**Option 1**, with a phased rollout so warm `/ship` stays green: build
`scripts/bdd-coverage.mjs` (the owned traceability gate) + the `tests/features/` layout now, wire it
as an **opt-in `/ship --full` gate** (dormant until V2-401 lands the `--full` tier in Phase 4), and
install the `playwright-bdd` runtime + config when that gate is flipped enforced. The Phase-2 pilot
(V2-210) writes real `.feature` files and runs `npm run bdd-coverage` to evidence the machine
verification; deleting a step definition reds the run (the acceptance test).

**Operator signed off (2026-07-17).** `playwright-bdd` is installed and the executor is wired
(`playwright-bdd.config.ts`, `npm run bdd:gen`/`test:bdd`; `bddgen` verified generating the pilot's
spec). Scenario EXECUTION needs a running app + seeded DB + per-role auth storage state (not present
in the build container), so `test:bdd` is a live-target/`--full` runner, never warm `/ship`. One
harness note: the `tests/**` ESLint block now disables `react-hooks/rules-of-hooks` — playwright-bdd
fixtures take a `use` callback the react-hooks plugin misreads as a Hook; test-harness code is not
React, so the rule doesn't apply there (no security rule was relaxed).

## Consequences

### Positive

- Story→test coverage is verifiable by a command, not a manual matrix.
- Gherkin scenarios read back to their EARS ACs; `.feature` files are the executable contract.

### Negative / Mitigations

- New dev-dependency (`playwright-bdd`) — ledgered; dev-only; install deferred to the enforced flip.
- Warm `/ship` must stay untouched — mitigated: the gate is `--full`-only and dormant (`npm run
bdd-coverage` exits 0 on an empty `tests/features/`).

## Migration triggers

- V2-401 lands `/ship --full` → wire `bdd-coverage` in as an enforced gate; install `playwright-bdd`.
- Operator declines the dependency → keep `bdd-coverage` as the traceability checker on plain
  Playwright specs (Option 2 fallback), drop the Gherkin executor.

## Related

- ADR-008 (Playwright UAT) · ADR-033 (blueprint stories) · V2-401 (`/ship --full`)
- `scripts/bdd-coverage.mjs` · `tests/features/` · `docs/build-vs-buy-ledger.md`
