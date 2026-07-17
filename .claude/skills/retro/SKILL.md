---
name: retro
description: After /qa or a phase end, run a structured retro (what broke / what was learned / what was missing) and turn it into durable one-line agent-memory entries; any "missing feature" finding is appended back to the relevant docs/benchmarks/<category>.md so the omission re-surfaces next time. Trigger phrases - "/retro", "retrospective", "phase retro", "what did we learn".
---

# /retro — structured retrospective + omission feedback loop

Most retros only capture what BROKE. This one also feeds forward what was
MISSING: every "missing feature" finding is written back to the benchmark it
should have been caught by, so the omission re-surfaces the next time
`/benchmark` runs (V2-201) instead of being rediscovered in production. That
omission→benchmark loop is the distinctive part — the rest is a disciplined
what-broke / what-learned pass that ends in durable `docs/agent-memory.md` lines.

Run it at a natural checkpoint: after a `/qa` run, at the end of a phase, or
when a feature lands. It reads the just-finished work and produces two durable
artifacts (memory entries + benchmark rows) — never session-specific noise.

## Steps

1. **Scope the retro.** Name exactly what you're reflecting on — a specific
   `/qa` run, a phase/program milestone, or a single feature. One scope per
   retro; don't sweep the whole project.
2. **Answer the three prompts explicitly** (all three, out loud, even if one is
   "nothing"):
   - **What broke / friction?** — bugs, red gates, dead ends, wasted loops.
   - **What was learned?** — the durable decision/gotcha/convention worth keeping.
   - **What was missing (omissions)?** — a capability, edge case, or feature that
     _should_ have been in scope and wasn't. This is the feed-forward column.
3. **Convert durable learnings into agent-memory** — for each "what was learned"
   fact that is durable (a decision, a costly gotcha, a convention), append one
   dated line to the correct themed section of `docs/agent-memory.md` using
   `/remember`'s mechanism (classify into one `##` section · `YYYY-MM-DD — <fact>`
   newest-first · one fact per line · promote-and-prune if the section nears its
   60-line bound). Then run `npm run memory-digest` to refresh the counts. **Do
   NOT bloat the ≤30-line digest** — a retro that adds five digest lines has
   failed the budget; promote stable entries out rather than stacking.
4. **Route every "missing feature" omission to the benchmark.** For each omission
   that names a feature/capability, append it to the relevant
   `docs/benchmarks/<category>.md` — a new row if the file is a scored table, or a
   dated "gaps found in use" note otherwise — so the benchmark _learns_ from what
   real use exposed. This closes the loop with `/benchmark` (V2-201): a gap caught
   once becomes a benchmark line that catches it every time after.
5. **Program/phase retro only:** also append the What-broke / What-learned /
   What-missing summary to the program's evidence file, so the phase record carries
   its own retrospective.

## Rules

- **Durable-only in agent-memory.** Decisions, gotchas, conventions that the next
  session/fork must not rediscover — nothing session-specific (that's
  `docs/SESSION-HANDOFF.md`'s job, not this file's). When in doubt, don't add it.
- **Respect the digest budget.** The ≤30-line digest is a recurring context tax on
  every session; `npm run memory-digest` warns when the digest >30 lines or a
  section >60. Promote-and-prune over append (the `/remember` curation rule).
- **Every omission that names a feature goes to the benchmark, not just chat.** A
  "we should have had X" said in the reply and nowhere else is lost by the next
  session. The benchmark row is what makes it re-surface. No feature omission is
  retro-complete until it's written to `docs/benchmarks/<category>.md`.
- **Don't manufacture entries.** If nothing durable was learned and nothing was
  missing, say so and write nothing — an empty retro is a valid retro.

## Skip when

- Nothing durable was learned and no omission surfaced (don't invent memory lines
  or benchmark rows to look thorough — that's noise, and it's a permanent tax).
- A trivial change (typo, rename, one-line fix) with no retro value.

## Related

- `/remember` — the append-to-memory mechanism this reuses in step 3.
- `/benchmark` — consumes the omission rows this writes in step 4 (V2-201).
- `/qa`, `/handoff-session` — the checkpoints a retro most often follows.
