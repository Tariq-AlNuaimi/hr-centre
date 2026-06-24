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
   survive a fresh container) and **commit it to the working branch (do not push
   yet — the push is step 3, after memory is also committed):**
   `git add docs/SESSION-HANDOFF.md && git commit -m "chore: session handoff"`.
   **NEVER merge this file to `main`.** It is working-branch scratch — transient
   in-flight state (dirty tree, started-but-unfinished work, "next steps") that is
   stale the moment the task ships and is meaningless to a fork that never had this
   session. It lives only on working branches and the next session overwrites or
   deletes it. The *durable* slice (decisions, landmines, conventions) is what
   reaches `main` — but via `docs/agent-memory.md` in step 3, not this file.

3. **Promote durable items to agent memory (ADR-022), then push.** Scan the
   **Decisions** and **Landmines** sections you just built: anything that will
   still matter *after this task ships* (a choice not to relitigate, a trap that
   cost time, a convention established) belongs in `docs/agent-memory.md`, not
   just the transient handoff. Append those as dated one-liners to the right
   section there (same rules as `/remember`), honoring its ~150-line curation
   budget — promote into CLAUDE.md / an ADR and prune rather than letting it
   bloat. Skip anything purely in-flight (that's what SESSION-HANDOFF.md is for).
   **Never write secrets/Restricted values** there — it is tracked, reaches
   `main`, and is inherited by forks. Recognize a Restricted value by
   `SECURITY.md` §1 (auth/DB/SMTP credentials, tokens, salaries, national IDs,
   etc.); if a landmine can only be stated by quoting one, generalize it instead.
   Concrete promotion: a landmine like *"forgot the middleware regex when adding
   `fr`"* becomes a **Gotchas & landmines** line —
   `2026-06-24 — Adding a locale also needs the regex in middleware.ts updated (next-intl strips the prefix).`
   Commit memory as its OWN commit (so it can
   land on `main` independently of the handoff scratch), then push both:
   `git add docs/agent-memory.md && git commit -m "chore: remember <summary>"` —
   then `git push`. **If there were no durable items, just `git push`.** And if
   the session produced no net work at all (nothing staged, `git status` clean
   beyond the handoff commit), there's nothing to promote — just `git push` the
   handoff commit and move on. Unlike the handoff file, `docs/agent-memory.md` IS
   meant to reach `main`.

   **Verify the push actually landed — do not assume.** A commit that wasn't
   pushed is invisible to the next session's fresh container (#3, #14), and a push
   can fail silently (network, auth, non-fast-forward, branch protection). After
   pushing, confirm the branch is in sync: `git rev-list --count @{u}..HEAD` must
   print `0` (and `git status -sb` should show no `ahead`). If it isn't 0, the push
   did NOT land — surface the exact error, retry (up to 4× with backoff for network
   errors), and do NOT report the handoff as done until the count is 0. The whole
   point of this skill is defeated if the carrier commit never reaches the remote.

4. Print the **entire handoff content** in the chat inside one fenced block,
   prefixed with this line so it is self-contained even with no file access:

   > New session: we are mid-stream on <repo>. Below is the full handoff — read
   > it, confirm the branch matches, then start on "Next steps" item 1. Do not
   > re-explore what it answers.

5. Tell the operator: start a new session (web) or `/clear` (laptop). If the new
   session is on the SAME working branch, `docs/SESSION-HANDOFF.md` is already
   there; otherwise paste the block from step 4.

## Rules
- Tracked file on the working branch is the durable carrier; the printed block is
  the zero-dependency fallback. Always produce both.
- `docs/SESSION-HANDOFF.md` is working-branch scratch — keep it off `main`.
- Total under 80 lines. If it wants to be longer, the session waited too long to
  hand off; tighten "Done" first.
