---
name: doubt-driven-development
description: Spins up a fresh-context reviewer biased to disprove a non-trivial decision before it ships, for when you're not sure you're right and reversing course is still cheap. Trigger on doubting a decision, wanting it stress-tested, or double-checking reasoning before committing -- not a diff review, design audit, or approach-comparison session.
---

# Doubt-Driven Development

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`doubt-driven-development`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

A confident answer is not a correct one. Long sessions quietly turn assumptions into
"facts" nobody re-checked. Doubt-driven development is the discipline of materializing
a fresh-context reviewer — biased to **disprove**, not approve — before a non-trivial
decision stands, while the decision is still cheap to unwind.

This is **in-flight**, not a gate on finished work: it runs _during_ the session, on a
decision you are about to lock in, not after the diff is done or the code is pushed.

## When to use

A decision is non-trivial when at least one is true: it introduces or changes
branching/auth logic; it crosses a module, service, or trust boundary; it asserts a
property the type system can't verify (idempotence, ordering, thread-safety); its
correctness depends on context a future reader can't see; its blast radius is hard to
reverse (migration, public API, an Ask-before surface).

Apply it when: about to lock an architecture pick under uncertainty; about to claim a
non-obvious fact ("this is safe", "this scales", "this matches the blueprint"); working
in unfamiliar code; a gate went green and that green is the _only_ thing making you
confident.

**When NOT to use** — do not doubt trivia; that is just slow:

- Mechanical operations: renames, formatting, file moves
- Following a clear, unambiguous instruction
- Reading or summarizing existing code
- One-line changes with obvious correctness
- Pure tooling: running tests, listing files

## When NOT this skill (boundaries with neighbours)

This template already has four things that look adjacent. None of them is this:

- **`/code-review`** is a verdict on a _finished_ diff — spec-compliance then quality,
  blocking before push. Doubt-driven runs _before_ the thing is finished, on a decision
  still being formed.
- **`senior-code-reviewer`** is the ADR-020 breadth pass that runs _after_ a push,
  looking for cross-cutting drift across the whole codebase. Doubt-driven is scoped to
  one decision, mid-session, before any push exists to review.
- **`security-architect`** is a design-level security review — trust boundaries, STRIDE,
  data classification — its own opus-tier persona. Doubt-driven is generic: it doubts
  _any_ non-trivial claim, security or not. If the claim is specifically about trust
  boundaries or data classification, invoke `security-architect` as the reviewer in
  Step 3 below rather than a generic one.
- **`/explore`** diverges on _approaches_ **before** the blueprint locks the architecture
  — it generates 2–3 options and scores them. Doubt-driven doubts a decision **already
  taken** — one option already won, and this checks whether the winner actually holds up.
- **`EnterPlanMode`** gets the _operator's_ sign-off on a plan via a round-trip. Doubt-driven
  is self-applied — no operator turn required — and can run any number of times inside
  a session the operator already approved the plan for.

## Steps

Copy this checklist when applying the skill:

```
Doubt cycle:
- [ ] Step 1: CLAIM      -- wrote the claim + why it matters
- [ ] Step 2: EXTRACT     -- isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT       -- dispatched a fresh-context reviewer, adversarial prompt
- [ ] Step 4: RECONCILE   -- classified every finding against the artifact text
- [ ] Step 5: STOP        -- met a stop condition (trivial findings / 3 cycles / override)
```

### Step 1 — CLAIM: name what stands

Two or three lines, no more:

```
CLAIM: "The new export route paginates safely under the
        list-route bound the scalability pillar requires."
WHY IT MATTERS: an unbounded findMany here is exactly the
                pattern the /ship scalability scan exists to catch --
                and this one is a custom bulk path the scan may not shape-match.
```

If you can't compress it this far, you have a vibe, not a decision — surface it before
scrutinizing it.

### Step 2 — EXTRACT: the smallest reviewable unit

The reviewer needs the **artifact** and the **contract**, not the journey that produced
them. Code: the diff or the function, not the whole file. A decision: 3–5 sentences plus
the constraints it must satisfy (a pillar, an ADR, the blueprint's scope). Strip your own
reasoning — hand over conclusions and you'll get back agreement with your conclusions.
If the unit is too big to hold in one read, decompose it first.

### Step 3 — DOUBT: dispatch a fresh-context reviewer

Dispatch a subagent (the Agent/Task mechanism `fan-out` also uses) with a prompt that is
**adversarial by construction** — framing decides the answer:

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for: unstated assumptions,
edge cases not handled, hidden coupling or shared state, ways the
contract could be violated, existing conventions this breaks,
failure modes under unexpected input.

Do NOT validate. Do NOT summarize. Find issues, or state explicitly
that none were found after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

Pass **ARTIFACT + CONTRACT only** — never the Step 1 CLAIM. Handing over the conclusion
biases the reviewer toward agreeing with it.

Pick the reviewer by domain: a design/trust-boundary claim goes to `security-architect`;
an operational-readiness claim goes to `sre`; everything else gets a plain subagent
carrying the adversarial prompt above. Never point this step at `senior-code-reviewer`
or `/code-review` — both expect a finished diff and a balanced verdict, not a mid-flight,
issues-only pass.

A gate passing is **not** evidence the claim survives this step. The enforcement quartet
(`docs/rules/harness.md`) **fails open by design** (ADR-047) — a malformed ledger or
ack silently lets a gated change through — and its own adjudication artifacts are
agent-writable, so an agent blocked by a gate can write its own entry and proceed. Green
`/ship` output is real (typecheck/lint/tests/build/secrets/audit did run), but a passing
_governance_ gate is process, not proof; don't let it stand in for Step 3.

### Step 4 — RECONCILE: fold findings back

The reviewer's output is data, not a verdict — you are still the one deciding. Re-read
the artifact text against each finding before classifying (rubber-stamping the reviewer
is the same failure as ignoring it). Classify each finding, first match wins:

1. **Contract misread** — the reviewer lacked context you owed it. Fix the CONTRACT, re-run.
2. **Valid + actionable** — real issue; change the artifact, re-loop.
3. **Valid trade-off** — real but not worth fixing now; document it (a wave-off in
   `docs/findings-register.md` if it maps to a pillar concern) so it's a recorded
   decision, not a silent shrug.
4. **Noise** — correct under context the reviewer didn't have; note it and ask whether
   adding that context to the CONTRACT would have prevented the false flag.

Before trusting your own instinct that a finding is noise, check
`docs/rules/harness.md`'s known-traps list and `docs/agent-memory.md` — a suspicion this
specific often turns out to already be a documented gotcha (or a documented non-issue)
rather than something to re-litigate from scratch.

### Step 5 — STOP: bounded loop, not recursion

Stop when the next cycle returns only trivial or already-considered findings, **or** 3
cycles complete (escalate to the user rather than grinding a fourth alone), **or** the
user explicitly overrides. If cycle 3 still surfaces substantive issues, that is
information about the artifact, not a reason to keep looping — say so. If 3 cycles feels
insufficient because the artifact is large, the artifact is too big: return to Step 2 and
decompose; don't lift the bound.

Once resolved, anything durable — a gotcha, a convention, a "this claim turned out to be
wrong because X" — belongs in `docs/agent-memory.md` via `/remember`, so the next session
doesn't have to doubt the same thing from zero.

## Common Rationalizations

| Rationalization                                | Reality                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I already checked it"                         | Checking it once, under the same context that produced the claim, is not independent review — that context is exactly what's biased. A fresh-context pass is a different check, not a repeat of the same one. |
| "The tests pass so it must be right"           | `npm run ship` green means the code you wrote matches the tests you wrote — both written under the same assumption. It's the objective floor, not proof the assumption itself was correct.                    |
| "I'm confident, skip the doubt step"           | Confidence tracks familiarity, not correctness, on novel problems — moments of certainty are exactly where blind spots hide.                                                                                  |
| "Dispatching a reviewer is expensive"          | Debugging this after it's merged and deployed costs more. The check is bounded (Step 5); the bug isn't.                                                                                                       |
| "The reviewer will just nitpick"               | Only if unscoped — constrain it to "issues that break this specific contract," not "is this good."                                                                                                            |
| "I'll doubt it at `/code-review` time instead" | `/code-review` is a finished-diff gate. By then the direction is set; doubt-driven catches a wrong direction while it's still one edit to fix, not a revert.                                                  |
| "The gate went green, that's enough"           | Two of the four enforcement gates fail open by design (ADR-047) and their artifacts are agent-writable — green there is process completing, not the claim being sound.                                        |
| "If I doubt every step I'll never ship"        | The skill is scoped to non-trivial decisions (see When to use / When NOT). Re-read the boundary before assuming it applies everywhere.                                                                        |

## Red Flags

- Dispatching a fresh-context reviewer for a one-line rename or formatting change
- Treating reviewer output as authoritative without re-reading the artifact text against it
- Looping more than 3 cycles without escalating to the user
- Prompting the reviewer with "is this good?" instead of "find issues"
- Re-dispatching on an unchanged artifact (same findings come back; that's stalling, not doubt)
- Pointing Step 3 at `/code-review` or `senior-code-reviewer` (wrong lane — see boundaries above)
- Treating a green governance gate as if it settled the claim (ADR-047 fail-open)
- **Doubt theater**: across 2+ cycles with substantive findings, zero were ever classified actionable — that's validating, not doubting; stop and escalate
- Stripping the CONTRACT from what the reviewer receives
- Passing the Step 1 CLAIM to the reviewer (biases it toward agreement)

## Verification

The exit criterion is that the doubt was **resolved with evidence**, not merely felt and
dismissed:

- [ ] The claim was written down (Step 1) before it was allowed to stand
- [ ] The reviewer received ARTIFACT + CONTRACT only — never the CLAIM, never your own reasoning
- [ ] The reviewer's prompt was adversarial ("find issues"), not validating ("is this good")
- [ ] Every finding was re-checked against the actual artifact text and classified (contract
      misread / actionable / trade-off / noise) — none were rubber-stamped or dismissed on feel
- [ ] Any finding treated as noise was cross-checked against `docs/rules/harness.md` known
      traps and `docs/agent-memory.md`, not waved off on instinct
- [ ] A stop condition was actually met (trivial findings / 3 cycles / explicit override) —
      not "I got tired of looping"
- [ ] If a governance gate was part of the confidence going in, its fail-open status
      (ADR-047) was weighed rather than treated as settled proof
- [ ] Anything durable that came out of the cycle was written to `docs/agent-memory.md`

## Related

- `/code-review` — the finished-diff verdict this precedes; run doubt-driven first on
  the decision, `/code-review` last on the resulting diff.
- `senior-code-reviewer` (`.claude/agents/senior-code-reviewer.md`) — the post-push
  breadth pass; a different lane, not a substitute reviewer for Step 3.
- `security-architect` (`.claude/agents/security-architect.md`) — the reviewer to pick
  in Step 3 when the claim is specifically about trust boundaries or data classification.
- `/explore` — diverges on approaches _before_ the blueprint locks architecture; doubt-driven
  doubts the _winner_ of that divergence, or any other decision already taken.
- `EnterPlanMode` — gets the operator's sign-off on a plan; doubt-driven is self-applied
  and needs no operator round-trip.
- `docs/rules/harness.md` — known-traps list; check it before trusting a "that's noise" call.
- `docs/uat-rubric.md` — the Five Pillars; a useful set of lenses for Step 1 CLAIMs that
  don't already have an obvious one.
- `/remember` — where a resolved doubt's durable finding goes.
