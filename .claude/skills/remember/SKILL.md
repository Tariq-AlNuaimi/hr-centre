---
name: remember
description: Append a durable, dated entry to docs/agent-memory.md so a decision, gotcha, or convention survives across sessions and forks. Use when something is learned that the next session must not rediscover or relitigate. Trigger phrases - "/remember", "remember that ...", "note this for next time", "don't forget X", "add to agent memory".
---

# /remember — write to cross-session agent memory (ADR-022)

Appends one curated line to `docs/agent-memory.md` — the durable counterpart to
`docs/SESSION-HANDOFF.md`. Memory is long-lived knowledge that lands on `main`
and is inherited by forks; handoff is transient working-branch state. Use this
for the former.

## Steps

1. **Classify the entry** into exactly one section of `docs/agent-memory.md`:
   - **Durable decisions** — a choice made with the operator (so it isn't relitigated).
   - **Gotchas & landmines** — a non-obvious trap that cost time; prefer a `file:line` or `ADR-NNN` pointer.
   - **Conventions discovered** — a pattern/idiom established in practice, not yet written elsewhere.
2. **Write one line**, newest at the top of its section:
   `YYYY-MM-DD — <fact>` (UTC date). Keep it to one fact; add `(ADR-NNN)` or
   `file:line` when there is a canonical home. Replace a section's `(none yet ...)`
   placeholder rather than stacking under it.
3. **Honor the curation rule.** If the file is near/over ~150 lines, do NOT just
   append — promote any now-stable entry into CLAUDE.md or an ADR and delete it
   here first. Bounded file in, bounded file out.
4. **Decide whether it belongs here at all.** If it's really an architectural
   decision, write an ADR (`/adr`) and leave a one-line pointer here. If it's a
   permanent rule, it belongs in CLAUDE.md. Memory is for the in-between.
5. **Commit on the working branch** (this file is meant to land on `main` via the
   normal merge): `git add docs/agent-memory.md && git commit -m "chore: remember <short summary>"`.
   Do not push solely for this; let it ride with the session's next push/`/ship`.

## Rules
- One fact per line; dated; newest-first within a section.
- This file is surfaced at every SessionStart — treat every line as a recurring
  context tax, same as CLAUDE.md. When in doubt, promote-and-prune over append.
- Never put secrets/Restricted values here (it's tracked and inherited by forks).
