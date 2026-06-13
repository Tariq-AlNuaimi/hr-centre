---
name: handoff-session
description: Produce a session-handoff (committed to the branch AND printed inline) so work continues in a FRESH session instead of a degrading, expensive long one. Use when the context watchdog warns (60%/80%), when switching tasks, or before ending a long session. Trigger phrases - "handoff session", "/handoff-session", "wrap up this session", "prepare a fresh session".
---

# Session handoff (token thrift, ADR-019)

Carrying a long conversation re-bills the whole history on every message and
degrades quality. This skill freezes session state so the next session loads it
for ~1k tokens instead.

## CRITICAL — how state survives depends on the environment
- **Remote / web (this template's default): a new session is a FRESH CONTAINER
  cloned from git.** A gitignored or uncommitted file does NOT exist there. So
  the handoff must travel by ONE of: (a) committed + pushed to the working
  branch, or (b) pasted by the operator into the new session.
- **Persistent machine (laptop CLI, `/clear` same dir):** a local file survives.

This skill does BOTH carriers so it works everywhere: it commits the handoff to
the branch AND prints the full content for the operator to paste.

## Steps

1. Build the handoff with exactly these sections, each as terse as truth allows:
   - **Goal** — the operator's task in their words, plus the current sub-goal.
   - **State** — branch, sync vs origin, `git status --short`, last `/ship`
     result, deployed or not. If the tree is dirty, say so **in bold**.
   - **Done** — landed commits this session (hash + one line each).
   - **In flight** — started-but-unfinished, with file paths.
   - **Decisions** — choices made with the operator (so they aren't relitigated).
   - **Landmines** — anything the next session must not trip on.
   - **Next steps** — numbered, concrete, first step actionable immediately.

2. Write it to `docs/SESSION-HANDOFF.md` (TRACKED, not gitignored — it must
   survive a fresh container) and **commit + push to the working branch**:
   `git add docs/SESSION-HANDOFF.md && git commit -m "chore: session handoff" && git push`.
   NEVER merge this file to `main` (forks must not inherit it) — it lives only on
   working branches and the next session overwrites or deletes it.

3. Print the **entire handoff content** in the chat inside one fenced block,
   prefixed with this line so it is self-contained even with no file access:

   > New session: we are mid-stream on <repo>. Below is the full handoff — read
   > it, confirm the branch matches, then start on "Next steps" item 1. Do not
   > re-explore what it answers.

4. Tell the operator: start a new session (web) or `/clear` (laptop). If the new
   session is on the SAME working branch, `docs/SESSION-HANDOFF.md` is already
   there; otherwise paste the block from step 3.

## Rules
- Tracked file on the working branch is the durable carrier; the printed block is
  the zero-dependency fallback. Always produce both.
- `docs/SESSION-HANDOFF.md` is working-branch scratch — keep it off `main`.
- Total under 80 lines. If it wants to be longer, the session waited too long to
  hand off; tighten "Done" first.
