---
name: router
description: Entry point for this repo's SDLC chain. Reports, from LIVE git/receipt state, which step you're on, what's next, and what's blocking: unpushed commits, missing Reviewed:/QA: trailers, gated-scope changes, uncovered blueprint Scope. Use first, or when lost: where am I, what's next, which skill.
---

# Router

## Overview

The skill catalogue is densely cross-linked but has no entry point: 34 of 41
skills carry no declared station on the stated lifecycle
(`/rebrand` → `/first-fork`/`/new-project`/`/deploy` → `/quickstart` →
`/scale-up` → `/handoff`), so a session that opens cold has "the tools but not
the path" (`docs/blueprints/sdlc-chain.md`, US3). This skill is the root:
invoke it first, or whenever you don't know where you are.

It does not gate, build, or review anything itself. It **reads live state**
(git, receipts, blueprint Scope) and reports three things (AC-3.1):

1. **Where you are** — inferred from working-tree/commit/push state.
2. **What's next** — the next unblocked step on whichever rail applies.
3. **What's blocking** — a missing receipt, an unpushed commit, an uncovered
   gated file — named specifically, never as a generic "something's wrong."

## When to use

- At the start of a session, or after a long gap, before touching anything.
- "Where am I", "what's next", "what's blocking", "which skill do I use",
  "how do I start".
- Before pushing or deploying, as a cheap live check ahead of the real gates
  (`.husky/pre-push`'s `review-gate.mjs`, the `qa-gate.mjs` PreToolUse hook).
- **Not** a substitute for `/blueprint` (deciding what to build), `/ship`
  (the actual verification gate), or `/qa` (the actual QA pipeline) — it tells
  you which of those to run next, it doesn't run their checks itself.

## Steps (the live-state read)

Run these in order. Every signal below was verified readable in this repo —
none of it is guessed. If a command errors, report "not verified here," never
guess a verdict from its absence (this is what makes the honesty requirement
concrete, not aspirational).

### 1. Working tree and unpushed commits

```bash
git status --short
git rev-list --count @{u}..HEAD   # errors if no upstream is set — report that, don't guess 0
```

A non-empty `git status --short` means you're mid-build. A nonzero unpushed
count means **the `Stop` hook will hard-block turn-end** until you push
(`CLAUDE.md`, "Pushed-or-it-didn't-happen") — this is always worth surfacing
as a blocker, not just a note.

### 2. Last-known-green state

```bash
cat .claude/state/last-green-sha 2>/dev/null || echo "absent"
```

`.claude/state/last-green-sha` is gitignored (`.claude/state/` in
`.gitignore`), so it is **absent in a fresh container** — that means "not
verified here," not "not green." When present, compare it to `git rev-parse
HEAD`: equal means the last `/ship` in *this* container covered HEAD; anything
else (including "absent") means run `/ship` before trusting green.

### 3. Which gated paths changed

```bash
# committed-but-unpushed (what review-gate.mjs will actually see at push time)
git diff --name-only @{u}..HEAD 2>/dev/null | grep -E '^(lib/|app/api/|prisma/schema\.prisma$|middleware\.ts$|auth\.ts$|auth\.config\.ts$)'
# plus anything still uncommitted, if you're about to commit it
git status --short | awk '{print $2}' | grep -E '^(lib/|app/api/|prisma/schema\.prisma$|middleware\.ts$|auth\.ts$|auth\.config\.ts$)'
```

This regex approximates `REVIEW_SCOPE_GLOBS` in
`.claude/hooks/lib/receipt.mjs` (`lib/**`, `app/api/**`,
`prisma/schema.prisma`, `middleware.ts`, `auth.ts`, `auth.config.ts`) closely
enough for these six literal globs, but `review-gate.mjs` is the actual
authority at push time — this is a preview, not a replacement.

### 4. Review / QA receipts

```bash
node .claude/hooks/lib/receipt.mjs verify --key Reviewed   # checks HEAD by default
node .claude/hooks/lib/receipt.mjs verify --key QA
```

Reads `VALID`/`STALE`/"no `<key>:` receipt on HEAD" — this is the same CLI
`review-gate.mjs`/`qa-gate.mjs` use internally, so it never drifts from what
the real gates will say (do not hand-hash; there is one implementation).
`STALE` means a rebase/amend touched a reviewed path after the trailer was
written (AC-1.6) — re-run `/review` or `/qa`, don't argue with the hash. This
only checks HEAD's own trailer; if the push spans several commits, a receipt
on an earlier commit in the range still counts at push time even if HEAD's
check alone shows none — say so rather than over-claiming a hard "missing."

Also check for a recorded, unadjudicated skip:

```bash
git log @{u}..HEAD --format=%B 2>/dev/null | grep '^Gate-Skip:'
```

Any hit is a loud flag: the skip let a push/deploy through, but it's still
unadjudicated until logged in `docs/findings-register.md` (AC-4.1).

### 5. Blueprint coverage of gated changes

For each gated path found in step 3:

```bash
node -e "import('./.claude/hooks/lib/scope-cover.mjs').then(m => \
  console.log(m.blueprintCovers('<path>', process.cwd())))"
```

`true` means a committed `docs/blueprints/*.md` `Scope:` line covers it —
`false` means the blueprint gate (`blueprint-gate.mjs`) will flag it as an
uncovered gated file next time it's touched. This is the exact function
`blueprint-gate.mjs` uses, reused rather than re-approximated.

### 6. Synthesize

State current step, next step, and blockers **only from what steps 1-5 showed
you** — a signal you didn't run is a signal you don't report on.

## The two rails

Every skill sits on the **lifecycle rail** (which milestone the artifact is
at) or the **discipline rail** (which verb you're doing right now). A skill
that fits neither goes under **meta/harness** rather than being dropped.

### Lifecycle rail (milestone-indexed) — 7 skills

| `/rebrand` | `/first-fork` \| `/new-project` \| `/deploy` | `/quickstart` | `/scale-up` | `/handoff` |
| ---------- | --------------------------------------------- | ------------- | ----------- | ---------- |
| identity swept | first live URL (three equivalent paths) | idea → shareable URL, ~10 min | add a capability the prototype rail lacks | package for IT |

### Discipline rail (verb-indexed) — 34 skills

| Verb | Skills |
| --- | --- |
| **define** | `blueprint` · `explore` · `benchmark` · `adr` |
| **plan** | `api-and-interface-design` · `adopt` |
| **build** | `scaffold-entity` · `design-system` · `incremental-implementation` · `stack-advisor` · `docs-current` · `migrate-from` · `conform` |
| **verify** | `test-driven-development` · `cover` · `design-qa` · `manual-uat` · `uat` · `qa` · `audit` · `performance-optimization` |
| **debug** | `debugging-and-error-recovery` · `browser-debugging` · `doubt-driven-development` |
| **review** | `review` |
| **ship** | `ship` · `docker` |
| **operate** | `observability-and-instrumentation` · `handoff-session` · `remember` |
| **evolve** | `sync-from-template` · `retro` |

### Meta / harness (cross-cutting execution tools, not an SDLC step)

`fan-out` (parallel-dispatch mechanism) · `batch` (capped headless per-file
runner) — both are *how* a step gets executed at scale, not a station on
either rail.

7 (lifecycle) + 34 (discipline + meta) = 41. Every skill accounted for.

## Common Rationalizations

| Rationalization | Reality |
| --- | --- |
| "`last-green-sha` is missing, so nothing's been shipped." | It's gitignored — absent in every fresh container regardless of history. Report "not verified here," not "not green" (honesty requirement). |
| "No `Reviewed:` trailer on HEAD, so nothing was ever reviewed." | The receipt can live on an earlier commit in the unpushed range and still satisfy the push gate. Check the range, not just HEAD, before calling it missing. |
| "I can just eyeball whether the diff is in scope." | The scope regex in step 3 is a close approximation of six literal globs, not a guess — use it, and defer to `review-gate.mjs` as the authority, don't hand-wave. |
| "The router can tell me review passed." | It can only tell you a receipt exists and is `VALID`/`STALE` — it cannot judge review quality. That verdict belongs to `/review` itself. |
| "No blueprint Scope covers this, but it's a small change." | `blueprintCovers()` returns a fact, not a size judgment — an uncovered gated file is what `blueprint-gate.mjs` will deny on, regardless of diff size. |

## Red Flags

- Reporting a position ("you're at review") without having run the command
  that signal depends on this turn — a stale guess is worse than "unknown."
- Treating an absent `.claude/state/last-green-sha` as "ship hasn't run" in a
  fresh container — it's gitignored, so absence there is expected, not a verdict.
- Reporting "reviewed" or "QA'd" from memory of a prior turn instead of
  re-running `receipt.mjs verify` — state can move (rebase, amend, new commit)
  between turns.
- Naming a blocker generically ("something's unreviewed") instead of the
  specific path(s) `receipt.mjs`/the scope grep actually named.
- Skipping step 5 and asserting blueprint coverage by reading `Scope:` lines
  by eye — `blueprintCovers()` applies the same broad-glob and expiry rules
  `blueprint-gate.mjs` does; eyeballing it misses both.

## Verification

Before calling this done:

- [ ] Ran the git status / unpushed-count check and reported its actual output
      (or its actual error), not an assumption.
- [ ] Checked for `.claude/state/last-green-sha` and reported "absent" honestly
      when it was absent, rather than inferring a verdict from that absence.
- [ ] Ran `receipt.mjs verify` for both `Reviewed` and `QA` and quoted its
      literal `VALID`/`STALE`/"no receipt" output.
- [ ] Checked for a `Gate-Skip:` trailer in the unpushed range.
- [ ] For every gated path found changed, ran `blueprintCovers()` rather than
      asserting coverage by inspection.
- [ ] The reported "current step / next step / blocking" all trace to one of
      the signals above — nothing asserted without a command backing it.

**Emits:** nothing — this step leaves no receipt. It is a read, not a gate;
the receipts it reads are written by `/review` and `/qa`, not by this skill.

## Related

- **`.claude/hooks/lib/receipt.mjs`** — the trailer hash/parse/verify CLI this
  skill reads from; never reimplement the hash.
- **`.claude/hooks/review-gate.mjs`** / **`.claude/hooks/qa-gate.mjs`** — the
  actual enforcement this skill previews; they are the authority, this is a
  cheap look-ahead.
- **`.claude/hooks/lib/scope-cover.mjs`** — `blueprintCovers()`, reused in
  step 5 rather than re-approximated.
- **`/review`**, **`/qa`** — emit the `Reviewed:`/`QA:` trailers this skill
  reads.
- **`/blueprint`** — writes the `Scope:` coverage step 5 checks against.
- **`docs/blueprints/sdlc-chain.md`** — the signed contract this skill
  implements (US3, AC-3.1, AC-3.2).
- **`CLAUDE.md`** — the lifecycle-rail sentence this skill's lifecycle table
  quotes verbatim.
