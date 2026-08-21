---
name: explore
description: BEFORE the blueprint locks architecture, generate 2-3 materially different approaches, build a pillars-aligned trade-off table, recommend one, and auto-draft the losing options into an ADR stub so the decision is archaeologically recorded. Feeds the blueprint's Architecture sketch + the "Reference consulted" line. Use when the user says "explore approaches", "what are the options", "diverge before committing", "/explore".
---

# /explore — Diverge on architecture BEFORE the blueprint locks it

The divergent-thinking station that runs _before_ `/blueprint` pins the HOW.
`/blueprint`'s Architecture sketch wants ONE approach written down; this is where
that one is _chosen_ — by generating 2–3 materially different candidates, scoring
them against the Five Pillars, picking a winner with a stated deciding pillar, and
recording the losers in an ADR stub so the rejected paths survive as archaeology
instead of evaporating. Output feeds two blueprint lines directly: the **winner** →
Architecture sketch, the **Reference consulted** → the Market-scan / Reference line.

**The rule:** the options must differ on a _real axis_ — not two layouts of the same
idea. Divergence you have to manufacture is slop (the blueprint's own "diverging on a
settled pattern is slop" note); real divergence is a fork you'd actually argue about.

## Steps

1. **State the decision** — one sentence naming the architectural fork, not the
   feature. "Sync or async job execution", "own the auth or adopt Auth.js providers",
   "denormalized read model vs. join-on-read", "server-boundary vs. client-fetched
   list". If you can't name a fork with ≥2 defensible sides, **skip** (see below) —
   there's nothing to explore.
2. **Generate 2–3 MATERIALLY different approaches.** Each must differ on a real axis:
   data model (normalized ↔ denormalized), sync ↔ async, build ↔ adopt, server ↔
   client boundary, push ↔ poll, single-table ↔ per-tenant, etc. Give each a name +
   a one-line description. Two near-identical shapes is one option, not two — collapse
   them and think harder.
3. **Build the pillars-aligned trade-off table.** One row per option, one column per
   pillar; score (✅/⚠️/❌ or 1–5) AND a phrase of _why_ per cell — a bare score is
   unfalsifiable:

   | Option         | Speed                   | Secure                    | Maintainable             | Scalable             | High-Quality           |
   | -------------- | ----------------------- | ------------------------- | ------------------------ | -------------------- | ---------------------- |
   | **A — <name>** | ⚠️ extra RSC round-trip | ✅ auth wrapper covers it | ✅ reuses `lib/services` | ✅ bounded query     | ✅ honest states cheap |
   | **B — <name>** | ✅ single fetch         | ⚠️ new trust boundary     | ⚠️ new primitive to own  | ❌ N+1 risk at scale | ⚠️ more error paths    |

   (Pillars per `CLAUDE.md` → Five Pillars / `docs/uat-rubric.md`. An AI-endpoint fork
   adds the conditional 6th column, AI-Quality — see `docs/rules/ai.md`.)

4. **Name the Reference consulted** — the studied _same-stack_ OSS codebase (repo +
   what you took from it), the `/scale-up` recipe, or the checked library. If nothing
   comparable exists, say so explicitly: **"none exists — greenfield."** This is the
   line the blueprint's Architecture sketch / Market-scan wants; don't leave it blank
   and don't invent a reference you didn't actually read (`WebSearch` the same-stack
   space first — CLAUDE.md market-benchmark rule).
5. **Recommend one** — name the winner and the **deciding pillar(s)**: "B, decided by
   Scalable — A's N+1 breaks the bound the list route must hold." The recommendation is
   what flows into the blueprint's Architecture sketch as _the_ approach.
6. **Auto-draft the LOSING options into an ADR stub** under `docs/decisions/` (via
   `/adr`, using the template's **Considered options** shape: every option — chosen and
   rejected — gets its own Good/Bad, and each loser's key Bad ties to the decision
   driver it failed). This is the archaeology: six months on, "why not async?" has a
   committed answer instead of a shrug. The stub is `Proposed`; it graduates to
   `Accepted` when the blueprint is signed off. This skill _describes_ creating the
   stub — invoke `/adr` to actually write it.

## Rules

- **Materially different or it's not an option.** Two variants of the same idea (same
  data model, same boundary, cosmetically different) count as ONE. Cross-reference the
  blueprint's "diverging on a settled pattern is slop, not exploration" — manufactured
  divergence wastes the reader's judgment.
- **Every option gets Good AND Bad** (ADR "Considered options" convention). An option
  with only upsides wasn't examined; the winner has real costs too — name them.
- **The ADR stub records why the losers lost**, not just that they lost — each rejection
  reason ideally cites the decision driver / pillar it failed, so the record is auditable.
- **The recommendation is a proposal, not a commitment.** `/blueprint` + operator sign-off
  is where it becomes the contract; `/explore` hands over the reasoned candidate, it doesn't
  bypass the gate.

## Skip when

- An existing **recipe or ADR already settles the architecture** — read it, cite it as the
  Reference, don't re-litigate a locked decision (ADR-001 stack, `/scale-up` recipe table).
- **One obvious approach, no real fork** — don't manufacture two straw options to look
  thorough. A single defensible path is a finding, not a failure; say so and move to
  `/blueprint`.
- **Pure CRUD that `/scaffold-entity` already shapes** — the entity → route → page path is
  settled; there's no architectural fork to explore.

## Do not skip this because…

| Rationalization                                                     | Rebuttal                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I already know which approach I'll use."                           | Then step 5 costs one sentence and step 6 records the alternatives you dismissed — which is exactly the "why not X?" a reviewer (or you, in six months) will ask. Knowing the answer isn't the same as recording the reasoning.                         |
| "There's only one way to build this."                               | If that's genuinely true, **Skip when** covers you — say so in one line. But most "only one way" is unexamined; force the second option and see if it dies honestly or teaches you something.                                                           |
| "The blueprint has an Architecture sketch — that's the same thing." | The sketch documents the _chosen_ approach; it has no slot for the rejected ones or the trade-off that killed them. `/explore` is the divergence _before_ that convergence — skip it and the blueprint records a decision with no visible alternatives. |
| "Writing an ADR for the losers is ceremony."                        | The losers are the expensive part to reconstruct later. A one-paragraph stub now is cheaper than re-deriving "we tried async and it failed the bounded-cost pillar" from scratch when someone proposes it again.                                        |

## Related

- `/blueprint` — consumes the winner (Architecture sketch) + the Reference line; run `/explore` first when the architecture has a real fork.
- `/adr` — writes the losing-options stub under `docs/decisions/` (template's Considered options shape).
- `/scale-up` — its recipe table is often the Reference consulted (or the reason to skip).
- `docs/uat-rubric.md` — the Five Pillars the trade-off table scores against.
