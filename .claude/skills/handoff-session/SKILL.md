---
name: handoff-session
description: Write a session-handoff file + paste-ready prompt so work continues in a FRESH session instead of a degrading, expensive long one. Use when the context watchdog warns (60%/80%), when switching tasks, or before ending a long session. Trigger phrases - "handoff session", "/handoff-session", "wrap up this session", "prepare a fresh session".
---

# Session handoff (token thrift, ADR-019)

Carrying a long conversation re-bills the whole history on every message and
degrades quality. This skill freezes the session state into a file the next
session can load for ~1k tokens.

## Steps

1. Write **`HANDOFF.md`** at the repo root (gitignored) with exactly these
   sections, each as terse as truth allows:
   - **Goal** — the operator's task in their words, plus the current sub-goal.
   - **State** — branch, `git status --short`, `git diff --stat` vs origin/main,
     last `/ship` result, deployed or not.
   - **Done** — landed commits this session (hash + one line each).
   - **In flight** — what is started but unfinished, with file paths.
   - **Decisions** — choices made with the operator (so they aren't relitigated).
   - **Landmines** — anything discovered that the next session must not trip on.
   - **Next steps** — numbered, concrete, first step actionable immediately.
2. Print the paste-ready prompt for the operator, exactly:

   > Continue from HANDOFF.md — read it first, then start on "Next steps" item 1.
   > Do not re-explore what it already answers.

3. Remind the operator: `/clear` (or new session), paste the line above.

## Rules
- HANDOFF.md is a scratchpad, never committed (it's in .gitignore).
- If uncommitted work exists, say so in **State** in bold — the next session
  must know the tree is dirty before touching anything.
- Total file under 80 lines. If it wants to be longer, the session waited too
  long to hand off; tighten "Done" first.
