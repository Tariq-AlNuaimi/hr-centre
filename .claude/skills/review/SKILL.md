---
name: review
description: Runs the binding pre-push review rail over the current diff and, when clean, writes the Reviewed trailer the push gate requires. Use before pushing changes to auth files, prisma/schema.prisma, app/api/**, or lib/** -- to review a diff or check a change for correctness before it goes out.
---

# Review

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`code-review-and-quality`, MIT), rewritten against this template's two-stage rail per ADR-022.

## Overview

`/review` is the pre-push half of the review rail declared binding in `CLAUDE.md`
and specified in `docs/rules/harness.md` ("Review rail -- two-stage, binding,
ADR-020, V2-206"). It exists because a review whose only output is transcript
text cannot gate anything (`docs/blueprints/sdlc-chain.md`, Problem & outcome):
this skill's job is to run the rail **and leave a receipt**, so the push gate
(`.claude/hooks/review-gate.mjs`, built alongside this skill) can tell whether
review happened at all, and whether it happened against the code that is
actually being pushed.

It runs **STAGE 1 -- spec compliance** before **STAGE 2 -- quality**, always in
that order, and never lets a flawless Stage-2 pass paper over a Stage-1 failure.

## When to use

- Before pushing any change touching auth files, `prisma/schema.prisma`,
  `app/api/**`, or `lib/**` -- this is where CLAUDE.md and `docs/rules/harness.md`
  make review **blocking**, and where the push gate (AC-1.1) will look for the
  receipt this skill emits.
- Whenever asked to "review my changes", "check this diff", "is this ready to
  push", or before invoking `/ship` on a change in that scope.
- On any change you have doubts about, even outside the gated scope -- the
  receipt is only _required_ there, not _useful_ only there.

**When NOT to use:**

- **After** a push, for cross-cutting breadth (audit completeness, operational
  drift, architecture-wide invariants) -- that is the `senior-code-reviewer`
  agent's job, run post-push per ADR-020. This skill is the pre-push diff gate;
  it does not replace the breadth pass.
- For UI/accessibility/visual fidelity -- that is `/design-qa`.
- For feature acceptance against user-facing behavior -- that is `/qa` / `/uat`.
- To decide _what_ to build or _whether_ an architecture is sound before code
  exists -- that is `/blueprint` / `/explore`. This skill reviews a diff against
  a blueprint that already exists; it does not write one.

## Steps

### 0. Scope the diff

Diff against the `origin/main` merge-base (or staged/unstaged changes if
uncommitted). List every changed file with its path.

### 1. STAGE 1 -- spec compliance (runs first, always)

1. For every changed file, find the `docs/blueprints/*.md` whose `Scope:` line
   covers it (glob match, same convention `blueprint-gate.mjs` uses).
2. **Gated-file check:** any changed `app/api/**/route.ts`, `app/**/page.tsx`,
   or `lib/**` file that is **not** covered by any matching blueprint `Scope:`
   is a **Stage-1 finding, High**. This is the check from `docs/rules/harness.md`
   verbatim -- it exists so a change can't quietly grow past what was scoped.
3. **Behavioral check:** read the covering blueprint's user stories and
   happy/worst scenarios (AC-*). Any diff behavior that contradicts a story or
   an AC -- not just an uncovered file, but code that does something the
   blueprint says it shouldn't -- is also a **Stage-1 finding**.
4. Use the plugin **`/code-review`** here as the mechanical diff-reading step
   (it reads the raw diff; it does not know what a blueprint `Scope:` is). Feed
   its output through the spec-compliance lens in steps 1-3 -- a finding from
   the plugin is not automatically a Stage-1 finding unless it maps to an
   uncovered file or a contradicted story/AC. Everything else the plugin
   surfaces is Stage-2 material, held until Stage 1 is clean.
5. **Any Stage-1 finding stops here.** A flawless-but-wrong change fails Stage 1
   and never reaches the quality lenses below -- do not run Stage 2, do not
   emit a receipt. Report the findings (file, what Scope/AC it violates) and
   stop.

### 2. STAGE 2 -- quality (only once Stage 1 is clean)

Five lenses, in order of leverage -- correctness, readability, architecture,
security, performance:

- **Correctness** -- edge cases, error paths, do the tests actually test this.
- **Readability** -- can another engineer follow it without the diff author
  explaining it; no bolted-on conditionals in an unrelated flow.
- **Architecture** -- fits existing patterns (`docs/REPO-MAP.md` checked
  first); no feature logic leaking into a shared module; no near-duplicate of
  an existing canonical helper.
- **Security** -- never softer than the floor: the thirteen `eslint-rules/*`
  at `error`, the `lib/api-helpers.ts` auth wrappers on every route, zod at the
  boundary from `lib/validations/`, no `session` cast to `any`. `npm run ship`
  automates the ESLint half of this; this step is the part a linter can't see
  (missing wrapper composition, a validation gap, a secret-shaped log line).
- **Performance** -- N+1s, unbounded `findMany` (the same pattern `/ship` step
  4b scans for), missing pagination.

### 3. Report

Lead with Stage 1: either the findings that stopped the review, or an explicit
**"Stage 1 clean"** line before any Stage-2 content. Label Stage-2 findings
Critical / Required / Nit as in the upstream checklist. Order by leverage --
one real Stage-2 issue outweighs ten nits.

### 4. Emit the receipt (only when both stages are clean)

On a clean review -- no unresolved Stage-1 finding, no unresolved Critical or
Required Stage-2 finding -- add a git trailer to the commit being reviewed:

```
Reviewed: <scope> <tree-sha>
```

- **`<scope>`** -- the sorted, comma-joined list of reviewed paths (the changed
  files from step 0 that fall in the gate scope below).
- **`<tree-sha>`** -- a git tree hash over exactly those paths' _current_
  blob content, not the whole commit tree.

**Do NOT compute this by hand.** `.claude/hooks/lib/receipt.mjs` is the single
source of truth for the hash, and the push gate verifies with the same code that
writes it -- so emitter and verifier cannot drift. Generate the whole trailer:

```bash
node .claude/hooks/lib/receipt.mjs trailer --key Reviewed <path> [<path>...]
```

Two independent implementations of one invariant is how a receipt quietly stops
matching and the gate becomes either always-deny or decorative. There is one.

Amend it onto the reviewed commit (`git commit --amend`) if not yet pushed, or
include it when creating the commit.

**Why content-bound (AC-1.6):** a bare `Reviewed: <scope>` trailer would
certify code nobody looked at the moment someone rebases or amends after the
fact -- the message survives, the diff underneath doesn't. Binding the trailer
to a hash of the _current_ content of the scope means a later edit to any
in-scope path changes its blob sha, which changes the tree-sha, which makes
the trailer's hash no longer match -- the receipt self-invalidates and review
is re-demanded, rather than silently certifying stale content.

## Common Rationalizations

| Rationalization                                            | Reality                                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The plugin `/code-review` already looked at it."          | The plugin reads the raw diff; it has no notion of a blueprint `Scope:` or an AC. It is Stage 1's diff-reading step, not Stage 1 itself -- run it, then apply the spec-compliance lens on top. |
| "It's my own code, I know it's right."                     | Authors are blind to their own assumptions -- the entire reason this rail is binding rather than optional. Self-review still runs both stages.                                                 |
| "Stage 2 came back clean, that's good enough."             | A flawless Stage-2 pass on a Stage-1 failure is still a Stage-1 failure. An uncovered file or a contradicted AC fails the review regardless of code quality.                                   |
| "I'll just amend the commit after review to fix a typo."   | Any amend to an in-scope path changes its blob sha and invalidates the trailer (AC-1.6) -- that's the design, not a bug. Re-run review after the amend.                                        |
| "It's outside `lib/**`/`app/api/**`, so no review needed." | The receipt is only _required_ in that scope (AC-1.2); running the rail on other changes you have doubts about is still worthwhile, just not gated.                                            |
| "The push gate will catch it if I'm wrong."                | The gate fails open on error (ADR-047) and only checks trailer presence/hash -- it cannot judge quality. It enforces that review happened, not that it was done well.                          |

## Red Flags

- A commit pushed to gated scope with no `Reviewed:` trailer, or a trailer
  whose tree-sha doesn't match the current content of its scope.
- Stage 2 findings reported before a Stage-1 pass was ever run.
- A Stage-1 finding (uncovered gated file, contradicted AC) noted but not
  blocking -- Stage 1 failing must stop the review, not just get logged.
- Relying on the `/code-review` plugin's raw output as the whole review --
  it doesn't check blueprint coverage and isn't the quality lens either.
- A receipt emitted while a Critical or Required Stage-2 finding is still
  open.
- Review run once, then the branch rebased or force-amended afterward with no
  re-review -- the trailer is stale even if nobody deliberately edited it.
- Treating this skill as a substitute for the post-push `senior-code-reviewer`
  breadth pass, or vice versa -- they cover different scope (diff-local vs.
  cross-cutting) and both are required by `CLAUDE.md`.

## Verification

- [ ] Stage 1 ran first and is either clean or its findings stopped the review
      before Stage 2 started.
- [ ] Every changed `app/api/**/route.ts`, `app/**/page.tsx`, `lib/**` file maps
      to a covering blueprint `Scope:`.
- [ ] No diff behavior contradicts a story or AC in the covering blueprint(s).
- [ ] All five Stage-2 lenses were applied once Stage 1 was clean, with
      findings labeled by severity.
- [ ] All Critical and Required findings are resolved or explicitly deferred
      with justification (a wave-off in `docs/findings-register.md`, not a
      silent skip).
- [ ] **Receipt scope:** a `Reviewed: <scope> <tree-sha>` trailer is present on
      the commit whenever the push touches auth files (`lib/auth.ts`,
      `middleware.ts`, Auth.js callback/session config), `prisma/schema.prisma`,
      `app/api/**`, or `lib/**` -- outside that scope no receipt is required.
- [ ] The tree-sha was computed over the _current_ content of exactly the
      reviewed paths, so a later edit to any of them invalidates it (AC-1.6).
- [ ] `npm run ship` still runs and is green before the push -- this skill
      replaces neither `/ship`'s automated checks nor the five-pillars
      checklist it affirms.

## Related

- **`/code-review`** (plugin) -- the raw diff-reader this skill calls as its
  Stage-1 mechanical step. `/review` orchestrates the rail around it; it does
  not duplicate or shadow it, and the plugin remains available standalone for
  a quick diff read that doesn't need the receipt.
- **`senior-code-reviewer`** (agent) -- the post-push breadth pass (audit
  completeness, trust boundaries, architecture-wide drift). Required after
  every code push per `CLAUDE.md`; this skill is the pre-push counterpart.
- **`/ship`** -- the automated typecheck/lint/test/build/secret/audit gate.
  Run alongside this skill, not instead of it: `/ship` verifies the code works,
  `/review` verifies it's the right code, done well.
- **`.claude/hooks/review-gate.mjs`** -- the pre-push hook that consumes the
  `Reviewed:` trailer (built in parallel with this skill; its internals are
  out of scope here -- only the trailer contract above is guaranteed).
- **`docs/rules/harness.md`** -- "Review rail -- two-stage, binding" is the
  rule this skill implements.
- **`docs/blueprints/sdlc-chain.md`** -- the signed blueprint this skill is
  task 2 of (AC-1.1, AC-1.6, the receipt design).
- **`docs/uat-rubric.md`** -- the five pillars this review's Stage-2 security
  and performance lenses are graded against.
