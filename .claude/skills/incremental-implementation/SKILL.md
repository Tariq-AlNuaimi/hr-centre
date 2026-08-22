---
name: incremental-implementation
description: Slices one signed-off task into thin vertical increments so every step ends green (npm run ship) and committed, instead of one large uncommitted diff. Use while executing a blueprint task or any multi-file change -- not for deciding what to build or for parallelizing disjoint units.
---

# Incremental Implementation

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`incremental-implementation`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

`/blueprint` produces the contract (user stories, acceptance criteria) and the work
DAG (`[P]`/`[S]` tasks with file-ownership sets). Nothing in this repo governs how
one task in that DAG actually gets **executed** — how its diff is sliced over time
so the tree stays green and pushable at every step instead of arriving as one large
commit nobody can bisect. That is the gap this skill fills: the discipline for
turning one DAG node into a sequence of small, verified, committed increments.

It does not decide WHAT to build (`/blueprint`'s job) and it does not parallelize
work (`/fan-out`'s job — disjoint units in SPACE). This skill slices ONE unit of
work over TIME.

## When to use

- Implementing one task from a signed `/blueprint` work DAG — especially an `[S]`
  task, or a `[P]` task big enough to outgrow a single sitting.
- Any change spanning more than one file, or one file you expect to grow past
  ~100 lines before you'd want to check it still compiles.
- Working the UI → API route → service → Prisma path end to end for one case.

**Not this:**

- Deciding what to build, or resolving open questions — that's `/blueprint`. This
  skill starts after a task already exists.
- ≥2 write-disjoint units that could run concurrently — that's `/fan-out`. Reach
  for that first when the DAG has parallel `[P]` tasks; use this skill _inside_
  each dispatched unit.
- 10+ near-identical per-file edits (a codemod/migration) — that's `/batch`.
- A single-file, single-function edit, a typo, a rename — scope is already
  minimal; slicing it further is ceremony.

## Steps

1. **Pull the next task from the DAG — don't re-derive it.** Open the signed
   `docs/blueprints/<feature>.md` work-DAG table (or the lightweight track's
   one-line design). Take the task in front of you, cite its `US`/`AC` id, and
   respect its declared file-ownership set — this skill executes a slice, it
   does not re-plan the DAG or widen the set.

2. **Check the gated paths before writing anything.** `lib/**`,
   `app/api/**/route.ts`, and `app/**/page.tsx` are watched by
   `blueprint-gate.mjs` (ADR-033) — a _new_ file there is denied unless a
   committed blueprint `Scope:` already covers it. If the blueprint isn't
   committed yet, **committing it is increment 1**
   (`git commit -m "docs: blueprint <feature>"`) before any code lands, or
   every later increment inherits a red gate.

3. **Cut a vertical slice, not a horizontal layer.** Prefer one complete path
   through this repo's stack — UI → API route (auth wrapper + zod) → service →
   Prisma — over "all the schema changes, then all the routes, then all the
   UI." A vertical slice is independently demonstrable: something in the
   running app works after it lands, even for one case only.

4. **Write the failing test first where behavior lives.** For logic in `lib/**`
   or `app/api/**`, hand the slice to `test-driven-development` rather than
   writing the implementation straight — a red test pins down what "this
   increment works" means before code makes it pass.

5. **Implement the smallest complete piece.** Simplicity first: the naive,
   obviously-correct version beats a premature abstraction; three similar
   lines beat a generic factory built for a second caller that doesn't exist
   yet. Touch only files inside this increment's declared set — note anything
   else worth fixing rather than fixing it in passing (a pillar concern
   becomes a `docs/findings-register.md` wave-off, not a silent detour).

6. **Run `npm run ship`.** This is the exit gate for _this increment_, not
   only for the final push — 19 phases warm (26 with `--full`): typecheck,
   lint, contract + component tests, the scalability/wave-off/tier/blueprint/
   db-structure static gates, build, gitleaks, npm audit. Stop on the first
   red phase and fix it before writing more code; never stack a second
   increment on a red one.

7. **Commit the green increment.** One increment, one commit, a message citing
   the story id. Don't bundle an unrelated cleanup or a second increment into
   the same commit — each should be independently revertable
   (`git revert` one without touching the next).

8. **Push before the session risks ending — not only at the very end.** The
   container is ephemeral and the `Stop` hook hard-blocks turn-end on unpushed
   commits (pushed-or-it-didn't-happen). A green, committed, unpushed
   increment is not yet a landed increment: `git rev-list --count @{u}..HEAD`
   should read `0` before you count a slice as done.

9. **Move to the next increment; carry forward.** Don't restart context or
   re-verify unchanged work — re-run `/ship` only after an edit that could
   affect its result.

## Common Rationalizations

| Rationalization                                                                                               | Reality (this repo)                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I'll build the whole task, then run `/ship` once at the end."                                                | A red `/ship` against an 800-line diff gives one `file:line` in a haystack. Each green increment already isolated where a break would be.                                             |
| "It's just a prototype / personal tier — I can skip the ceremony."                                            | Tier scales ceremony, never the security floor. `/ship` before every push is the bar for `personal` and `shared` alike (CLAUDE.md "Project tiers").                                   |
| "`blueprint-gate.mjs` only warns on `personal`, so I'll build the route first and write the blueprint after." | A warn today is a block the moment this fork sets `"tier": "shared"`, and a post-hoc blueprint is a changelog wearing a costume — it can't catch the divergence it exists to prevent. |
| "These two increments are tiny, I'll commit them together."                                                   | Small commits are free; a bundled commit turns `git revert` into an all-or-nothing bet on both changes being right.                                                                   |
| "I ran `/ship` five minutes ago, it's still green."                                                           | Green describes a commit, not a session. Re-run after any edit since — the tsc/eslint caches make a truly-unchanged re-run nearly free anyway.                                        |
| "I'll push everything at the end of the session."                                                             | The `Stop` hook doesn't wait for "the end" — it hard-blocks on any unpushed commit the moment a turn tries to close. Push each increment as it lands.                                 |

## Red Flags

- More than one increment's worth of code written before the first `npm run ship`.
- A new `app/api/**/route.ts` or `app/**/page.tsx` file with no committed
  blueprint `Scope:` covering it yet.
- A commit message describing two unrelated things ("add widget route + refactor
  auth helper").
- Uncommitted changes piling up across more than one increment.
- `git rev-list --count @{u}..HEAD` > 0 while treating the task as done.
- Widening a task's declared file-ownership set mid-slice instead of stopping to
  update the DAG.
- Building an abstraction for a second caller that doesn't exist yet.

## Verification

Before calling a task's increments done:

- [ ] Every increment ran `npm run ship` green before its own commit — not just
      once at the very end
- [ ] Each commit is one logical change, citing its `US`/`AC` id
- [ ] Any gated-path file (`lib/**`, `app/api/**/route.ts`, `app/**/page.tsx`) is
      covered by a committed blueprint `Scope:`
- [ ] `git status` shows no uncommitted changes belonging to this task
- [ ] `git rev-list --count @{u}..HEAD` reads `0` — every commit is pushed, not
      just made
- [ ] No file outside the task's declared file-ownership set was touched

## Related

- `/blueprint` — decides WHAT and produces the work DAG this skill executes one
  node of; don't re-plan here.
- `/fan-out` — parallelizes ≥2 write-disjoint units in SPACE; this skill slices
  ONE unit over TIME. Use both together: `/fan-out` dispatches the wave, each
  dispatched unit runs its own increments per this skill.
- `test-driven-development` — how one increment's implementation step is driven
  once the slice is chosen.
- `/batch` — 10+ near-identical per-file edits; not incremental feature work.
- `/ship` — the green bar every increment must clear.
- `docs/REPO-MAP.md` — "where is X" before adding a file that might duplicate an
  existing one.
