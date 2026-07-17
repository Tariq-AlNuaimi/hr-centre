# ADR-057 — Parallel execution mechanism: native subagent dispatch vs a custom `/fan-out` skill

**Status:** Accepted (2026-07-17, Tariq Al-Naaimi — verdict: **custom `/fan-out`**, operator override of the native recommendation)
**Date:** 2026-07-17
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-054 (routing receipts moved advisory→observed — the trace this builds on), ADR-022 (agent memory + model-tier routing), ADR-034 (over-engineering/complexity gate — the "don't build what native already does" test this decision applies to itself), V2-104 (the parallel-by-default constitution instruction this chooses the _mechanism_ for).

## Context

V2-104 landed the **parallel-by-default** instruction: before a multi-part task,
decompose it, and if ≥2 units are write-disjoint, dispatch them as parallel
subagents in one message. That is the _instruction_. V2-105 (this ADR) decides the
_mechanism_ underneath it — and, per the KICKOFF contract, gates the build: a custom
`/fan-out` orchestration skill is written **only if** the verdict here is "custom".

The question is whether Claude Code's **native** subagent capabilities already
deliver parallel-by-default, or whether the template needs a bespoke orchestrator
skill on top. This was researched two ways (native-capability survey + a repo
inventory of what already exists) and cross-checked against **directly observed
in-session behavior**, so the choice rests on tested behavior, not assumption.

### Evidence — native capability (as of early 2026)

- **Concurrent dispatch works natively.** Multiple subagents dispatched via the
  Agent/Task tool in a **single assistant message** run concurrently (practical
  wave ~5–6; the Workflow runtime caps at 16 concurrent / 1000 total for
  script-driven fan-out). _Observed this session:_ two agents (`claude-code-guide`
  and `scout`) dispatched in one message ran in parallel and both returned — the
  native path is real, not theoretical.
- **Custom agents already routable.** `.claude/agents/*.md` frontmatter
  (name/description/model/tools) is the native definition format; the main agent
  routes to them by tier. The template already ships four (scout, senior-code-reviewer,
  security-architect, sre).
- **Three native tiers exist:** (1) in-message subagent dispatch (what V2-104 uses),
  (2) experimental **Agent Teams** with a shared task list (TaskCreate/Update/List,
  SendMessage) for visibly-coordinated inter-communicating work, (3) **Workflows**
  (script-driven, `agent()`/`pipeline()`, background) for 50+-item fan-out.
- **What native does NOT enforce:** file-ownership / disjoint-write scopes are a
  **manual** responsibility — the harness advises "give each unit different files"
  but does not hard-fail an out-of-scope write. Subagents cannot nest.
- **Routing receipts are unreliable for async dispatch _in this environment_.**
  _Observed this session:_ the V2-106/107 parallel wave did **not** populate
  `.claude/state/routing-receipts.jsonl` — async Agent dispatch did not fire the
  `PostToolUse(Task)` hook that `routing-receipt.mjs` binds to. Git-diff disjointness
  had to stand in as the evidence trail.

### Evidence — what the repo already has

| Asset                                                    | Role                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `.claude/rules/harness.md` §Parallel-by-default (V2-104) | the binding _instruction_ + file-ownership-set discipline                       |
| `.claude/hooks/routing-receipt.mjs`                      | observe-only `PostToolUse(Task)` receipt (unreliable for async dispatch, above) |
| `scripts/routing-report.mjs`                             | summarizes receipts vs the ADR-022 tier table; never enforces                   |
| `.claude/skills/batch/SKILL.md`                          | headless per-file loop (sequential, not a parallel wave)                        |

A custom `/fan-out` skill would **duplicate the dispatch pattern already bound in
harness.md**. The only thing native genuinely lacks is _enforcement_ (hard
file-ownership scoping + an auto-verify-then-integrate loop) — and that is exactly
the kind of speculative machinery ADR-034 exists to stop us building before a real
incident demands it.

## Decision drivers

- **ADR-034 (don't over-engineer).** Native dispatch already works; building an
  orchestrator to wrap a capability the platform ships is the over-engineering the
  complexity gate is meant to catch. Build only for a demonstrated gap.
- **V2-104 is an _instruction_, and instructions are cheaper than code.** The
  parallel discipline (decompose → disjoint sets → one-message dispatch → verify →
  one `/ship`) lives as constitution text; it needs no runtime skill to be followed —
  it was followed twice this phase (V2-106/107 wave, and this very research wave).
- **Enforcement gap is real but not yet load-bearing.** No overlap-corruption
  incident has occurred; file-ownership is currently honored by discipline. Paying
  for enforcement now is pre-paying for a risk that hasn't fired.
- **Portability.** A native-only answer travels to any fork with zero new surface;
  a `/fan-out` skill is one more thing to version, sync, and self-review (ADR-054).

## Considered options

### Option 1 — Native dispatch + existing observe-only receipts (recommended, NOT chosen)

Rely on native in-message subagent dispatch, governed by the V2-104 instruction and
the existing (observe-only) `routing-receipt.mjs` / `routing-report.mjs`. No new skill.

- Good, because it works today — demonstrated twice this phase with disjoint diffs.
- Good, because it adds zero new harness surface (ADR-034, portability, ADR-054 self-review load).
- Good, because file-ownership stays a discipline the instruction already mandates.
- Bad, because file-ownership is unenforced — an out-of-scope write is caught by review/`/ship`, not blocked at dispatch.
- Bad, because async-dispatch receipts are unreliable here (mitigated: git-diff disjointness is the fallback trail; fixing the hook is a separate, smaller task).

### Option 2 — Custom `/fan-out` orchestration skill (chosen)

A skill that takes a declarative decomposition (units + file-ownership sets + deps),
dispatches the wave, hard-verifies the combined change-set is aggregate-disjoint, then integrates.

- Good, because it makes file-ownership _enforced_, not advisory (the one real native gap).
- Good, because it names the decomposition and standardizes the verify-then-integrate loop.
- Bad, because it re-implements dispatch that native already does (ADR-034 over-engineering).
- Bad, because it is new versioned/synced/self-reviewed surface for a risk that hasn't fired.
- Bad, because enforcement it would add (blocking out-of-scope writes) is better placed in a
  PreToolUse hook than a skill, if/when it's needed.

### Option 3 — Hybrid: native dispatch now, a thin verify-only helper later

Keep native dispatch; if waves become frequent, add a small **verification** helper
(confirm each unit's diff is within its declared set) rather than a full orchestrator.

- Good, because it defers the only real gap to the moment evidence demands it.
- Good, because a verify-only helper is far smaller than a `/fan-out` orchestrator.
- Bad, because it needs a named trigger to avoid drifting into "build it anyway".

## Decision

**Chosen (operator verdict, 2026-07-17): Option 2 — build the custom `/fan-out` skill.**

This was an `ASK` (KICKOFF). The analysis _recommended_ Option 1 (native, no skill) on
ADR-034 grounds. The operator **overrode** that recommendation and chose the custom
`/fan-out` skill — the deciding driver being the one real native gap: file-ownership is
**advisory, not enforced**, and the operator wants that enforcement built as a first-class,
named orchestration surface rather than deferred behind a future incident. The recommendation
is preserved above as the honest record; the decision is the operator's.

Accordingly `/fan-out` ships as a skill that: (1) takes an explicit decomposition (units +
disjoint file-ownership sets + dependency notes), (2) refuses to dispatch when the declared
sets overlap, (3) dispatches the write-disjoint units as native parallel subagents in one
message (it uses the native mechanism — it does not replace it), (4) hard-verifies the
combined change-set is **aggregate-disjoint** — every changed file matches exactly one
declared set (0 = out-of-scope, ≥2 = the sets weren't disjoint) — and (5) integrates, then
runs **one** `/ship` over the combined result. It is the enforcement layer over V2-104's
discipline, not a second dispatch engine.

_Scope of the guarantee (senior-review):_ native in-message dispatch writes into ONE shared
working tree, so there is no per-subagent diff to attribute — the check is over the wave's
**combined** change-set, not "unit X wrote only its files." It catches any file written
outside every declared set, or on a real collision between two sets; it cannot catch unit B
writing into unit A's _declared_ territory (that file still matches exactly one set — A's).
True per-unit attribution would need worktree/branch isolation per subagent, a materially
bigger change than ADR-034's "thin git/path arithmetic" mandate; deferred to the migration
triggers. The pre-dispatch overlap refusal (`check-overlap`) uses a **sound** glob-intersection
test (not a heuristic), so a colliding manifest is refused before any subagent runs.

## Consequences

### Positive

- File-ownership becomes **enforced**: `/fan-out` refuses to dispatch on declared-set
  overlap (sound intersection test) and verifies the wave's combined change-set is
  aggregate-disjoint after return — the native gap closed (within the attribution limit noted above).
- The parallel-wave workflow (decompose → dispatch → verify → one `/ship`) is named,
  repeatable, and self-documenting instead of ad-hoc per session.
- Verification gives a reliable evidence trail (per-unit git-diff-vs-declared-set) that does
  not depend on the async-unreliable `routing-receipt.mjs` hook.

### Negative

- New harness surface: one more skill to version, `/sync-from-template`, and self-review
  (ADR-054) — the cost ADR-034 flagged, accepted by operator verdict.
- `/fan-out` wraps native dispatch, so a future change to native subagent semantics could
  require the skill to track it.

### Mitigations

- `/fan-out` **uses** the native dispatch mechanism (parallel subagents in one message); it
  does not re-implement it, minimizing coupling to internals.
- The overlap-refusal + post-hoc diff check are pure git/path arithmetic (no new deps), keeping
  the skill thin and within the ADR-034 complexity budget.
- The `routing-receipt.mjs` async under-recording is logged in `docs/findings-register.md` as a
  separate follow-up; `/fan-out`'s own diff-verification does not depend on it.

## Alternatives considered

1. **Native, no skill (Option 1)** — recommended by the analysis but **not chosen**: the operator
   prioritized enforced file-ownership now over deferring it behind a future incident (ADR-034 cost accepted).
2. **Hybrid verify-only helper (Option 3)** — subsumed: `/fan-out` includes the verify-only diff
   check as one of its steps, so a standalone helper is unnecessary.
3. **Full Agent-Teams / Workflows adoption as the default** — deferred: right for
   50+-item audits/migrations and visibly-coordinated work, overkill for the routine
   2–3-way disjoint waves V2-104 targets. `/fan-out` may delegate to these when a wave's scale calls for it.

## Migration triggers

Revisit `/fan-out`'s design when ANY fires:

- Waves routinely exceed ~4 units or need dependency-DAG coordination → have `/fan-out` delegate to
  native Agent Teams / Workflows rather than one-message dispatch.
- Native subagent-dispatch semantics change → update the skill's dispatch step to track them.
- The overlap-refusal / diff-verification proves too coarse (e.g. legitimately shared generated files) →
  refine the file-ownership model (allow-list shared paths).
- A cross-contamination incident occurs that aggregate-disjointness can't catch (unit B writes into
  unit A's _declared_ territory) → give each subagent an isolated worktree/branch so its own diff can be
  attributed and checked against its own set (the per-unit attribution deferred as over-budget here).

## Related

- V2-104 parallel-by-default instruction (`.claude/rules/harness.md`)
- ADR-034 over-engineering/complexity gate · ADR-022 model-tier routing · ADR-054 routing receipts (observed)
- `.claude/hooks/routing-receipt.mjs` · `scripts/routing-report.mjs`
