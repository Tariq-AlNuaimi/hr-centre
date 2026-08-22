# ADR-064 — The SDLC chain: receipt-gated build loop

**Status:** Accepted (`docs/blueprints/sdlc-chain.md`, signed Tariq Al-Naaimi, 2026-08-22)
**Date:** 2026-08-22
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-047 (WS-8 harness hardening — the fail-closed/fail-open split and the
gate-quartet this extends, not supersedes), ADR-032 (build-vs-buy gate — the enforcement
idiom this chain reuses), ADR-033 (blueprint-before-build gate — the first link of this
chain), ADR-034 (complexity-budget gate), ADR-022 (agent memory — `docs/agent-memory.md`).

## Context

Measured by SDLC phase, the template invested almost nothing in the middle of the build
loop: BUILD carried 7 skills / 758 lines, VERIFY carried 1 skill / 79 lines, and REVIEW
carried **zero** skills — against a reference catalogue (`addyosmani/agent-skills`) of
4,342 lines across the same phases. Both endpoints were automated (idea to a live URL in
minutes via `/new-project`/`/quickstart`; finished app to IT via `/handoff`), and the
middle was improvisation.

Worse, the steps that did exist were not chained. Exactly **one** state token existed in
the repo (`.claude/state/last-green-sha`, consumed by `.husky/pre-push` to gate on a green
`/ship`). `CLAUDE.md` declared the review rail **binding** — "before any push touching
auth, schemas, API routes, or `lib/`, run `/code-review` (blocking)" — and nothing
enforced it, because `/code-review` printed findings to the transcript and left no
artifact. That is a design defect, not a discipline defect: a step whose only output is
transcript text cannot gate anything, and will be skipped under load.

## Decision

Adopt nine skills from `addyosmani/agent-skills` (MIT), rewritten in house style per
ADR-022's built-not-imported convention (`docs/build-vs-buy-ledger.md`, 2026-08-22 entry),
to give the build loop a real process for slicing, testing, debugging and review. Pair
that process with a **mechanism**: a step emits a durable token, and the next step's gate
requires it before it will proceed. Every link that already worked in this repo had
exactly that shape — `/blueprint` emits a committed `Scope:` glob consumed by
`blueprint-gate.mjs` (ADR-033); `/ship` emits `last-green-sha` consumed by
`.husky/pre-push`; a commit leaves an unpushed ref consumed by `session-stop.mjs`. This
decision copies the shape onto the two links that were missing it (review, QA) and adds a
sixth link that makes the whole chain self-policing (gate-skip adjudication).

**Receipts are content-bound git trailers**, not `.claude/state` files or a committed
receipts document:

- `Reviewed: <scope> <tree-sha>` — emitted by `/review` (`.claude/skills/review`), verified
  by `.claude/hooks/review-gate.mjs` at `git push` (`.husky/pre-push`, after `npm run
ship`).
- `QA: <scope> <tree-sha>` — emitted by `/qa`, verified by `.claude/hooks/qa-gate.mjs`
  (a `PreToolUse` hook on `Bash`) before `/deploy`'s provisioner runs.
- `Gate-Skip: <gate-name> <reason>` — the recorded-ack bypass (AC-4.1/4.2), consumed by
  both hooks at the point of the skip and by `scanGateSkips()` in `scripts/ship.mjs`,
  which REDs the warm `/ship` loop until the skip is adjudicated in
  `docs/findings-register.md`.

A trailer travels with the commit, survives the ephemeral containers this repo runs in
(complaint #14), and needs no separate state store or branch churn. Critically, it is
**bound to a tree hash over the scope it certifies**, not just present on the commit
message. `.claude/hooks/lib/receipt.mjs` computes that hash by building a temporary git
index holding only the in-scope paths at their current blobs (`git read-tree --empty` +
`git update-index --add --cacheinfo` per path) and running `git write-tree` over it — the
same algorithm from a commit (blobs read via `git ls-tree`) or from the working tree
(blobs via `git hash-object -w`), so the emitter (`/review`, `/qa`) and the gates agree by
construction. A rebase that resolves conflicts, or a later amend, changes the content of a
scoped path, which changes that path's blob sha, which changes the tree-sha, which no
longer matches the trailer — the receipt self-invalidates and review (or QA) is
re-demanded, rather than certifying code nobody looked at. Deleting a scoped path also
changes the hash (its entry leaves the tree), so deletion cannot dodge the receipt either.
An empty scope refuses to emit at all (`strict: true` in `computeScopeHash`) rather than
silently hashing to the empty tree — a receipt over zero files being verifiable was found
and closed before this wave shipped.

**Scope.** The review gate covers `lib/**`, `app/api/**`, `prisma/schema.prisma`,
`middleware.ts`, `auth.ts`, `auth.config.ts` — CLAUDE.md's existing "auth, schemas, API
routes, or `lib/`" wording — **plus `.claude/hooks/**` and `scripts/**`**, added after this
wave shipped its own three hooks, a receipt library and two gates with no review receipt
at all, because harness paths were outside every prior `Scope:`. A hook change can switch
a fail-closed guard (`protect-secrets`, `dangerous-commands`, `bash-write-gate`) off, and
`scripts/ship.mjs` **is** the gate, so this code carries at least the blast radius of
`lib/**` and is reviewed the same way.

## The fail-open / fail-closed split

These two new gates are **governance gates**, not security guards, and they inherit
ADR-047's posture rather than picking a new one:

- A hook that **cannot evaluate** a request — malformed stdin, a git failure, a detached or
  empty repo, any thrown error — **fails OPEN**: the push or the deploy proceeds, with a
  loud warning naming the gate and stating that the receipt was not verified. Every
  function in `receipt.mjs` throws rather than guessing on a git failure; the callers
  (`review-gate.mjs`, `qa-gate.mjs`) are what catch the throw and allow.
- A **MISSING or stale receipt** — the hook evaluated the request fine and the answer is
  "no valid receipt exists" — **hard-DENIES**. This is unconditional, not tiered by risk
  the way `blueprint-gate.mjs` is (that gate accepts a cheap lightweight stub mid-flight;
  a QA pass is not cheap to fabricate, so `qa-gate.mjs` does not offer an equivalent
  fast path).

These are two different axes, and ADR-047 is explicit that conflating them is the mistake:
"cannot evaluate" is a harness fault that must never wedge the operator out of legitimate
work; "evaluated, and the answer is no" is the gate doing its job. This ADR extends
ADR-047's split onto two new hooks rather than restating or superseding it.

## Consequences

### Positive

- The review rail goes from prose CLAUDE.md declared binding and nothing enforced, to a
  mechanism: a push touching a gated path without a valid `Reviewed:` trailer is rejected,
  naming the specific unreviewed paths.
- `/deploy`'s provisioner refuses to run without a valid `QA:` trailer at HEAD, closing the
  gap where an unQA'd app could reach a live URL indistinguishable from a QA'd one.
- A rebase or amend that changes reviewed/QA'd content cannot silently keep certifying it —
  the hash binding makes staleness detectable instead of assumed away.
- A deliberate skip is possible (hotfix pressure is real) but is never silent: it is a
  commit trailer, visible forever in git history, and it REDs the warm `/ship` loop until
  adjudicated in `docs/findings-register.md` — the same rule CLAUDE.md already applies to
  pillar wave-offs.
- `/quickstart`'s ~10-minute idea-to-URL path is untouched: it deploys via `git push`
  (Vercel auto-build), which `qa-gate.mjs` deliberately does not match, and an explicit
  `QUICKSTART=1` prefix is honoured if the provisioner is ever invoked directly.
  (Superseded 2026-08-22, breadth review round 4: the review-gate half of this
  exemption is a `Quickstart: <reason>` COMMIT TRAILER, not an env var. Ambient
  environment is not scoped to the push being evaluated -- one `export QUICKSTART=1`
  silently disabled a binding control for every later push from that shell, with
  nothing in git history to show for it, and `/quickstart` never set the variable
  anyway. The trailer is scoped, recorded and auditable. `qa-gate` keeps its
  command-string form, which was already correctly scoped to one invocation.)

### Negative / risk

- **The trailer can be gamed by scoping it narrower than what actually changed.** `/review`
  computes the hash over whatever paths it is told to certify; nothing forces that set to
  equal the full diff. A `Reviewed: lib/foo.ts <hash>` trailer on a commit that also
  touches `lib/bar.ts` satisfies the gate for `foo.ts` and leaves `bar.ts` unreviewed with
  no error. This is the same agent-writable weakness `docs/rules/harness.md` already
  documents for the build-vs-buy and blueprint gates: the artifact is a governance record,
  not a proof.
- **`/quickstart` is exempt from the QA gate by design**, not by omission — an app can
  reach a live, shareable URL with zero QA receipt. This is the intended trade for the
  fast path and is stated as such (AC-1.4), but it means "has a URL" and "was QA'd" are
  not the same claim for a `/quickstart` app, and nothing in the URL itself says which one
  applies.
- **`git push --no-verify` remains git's own escape** and is out of scope to remove — the
  chain's only bypass mechanism is the recorded `Gate-Skip:` trailer; a developer who skips
  the husky hook entirely leaves no record at all. This ADR does not attempt to close that
  hole; it is a pre-existing property of git hooks generally.
- **The chain is on by default for every fork**, the same posture as the security floor and
  the enforcement quartet (blueprint decision 16). A fork operator's first hard-deny from
  `review-gate.mjs` or `qa-gate.mjs` may be their first encounter with the chain at all —
  there is no opt-in ramp. Mitigated by each gate's deny/advisory message naming the exact
  fix (the `/review` or `/qa` skill to run, and the `receipt.mjs trailer` command to
  compute the value by hand if needed) and by the per-link backout below.
- Two more skills' worth of always-on routing surface; mitigated by the description-budget
  work in the same blueprint (≤300-char mean over 41 skills) and the Tier-2 routing eval
  now gating the warm `/ship` loop (`--min-rank1 80`) so a routing regression cannot land
  silently.

### Mitigations

- **Per-link backout.** Each gate is one file with one invocation line (`review-gate.mjs`
  in `.husky/pre-push`; `qa-gate.mjs` in `.claude/settings.json`'s `PreToolUse`). Removing
  that one line disables that link without touching the other gate, the nine skills, or
  the router.
- The deny message on both gates prints the exact `node .claude/hooks/lib/receipt.mjs
trailer --key <Reviewed|QA> <paths>` invocation needed to produce a valid receipt by
  hand, so a fail-open warning or a hard-deny is never a dead end.
- `scanGateSkips()` closes the "recorded but never surfaced" half of the skip mechanism —
  a skip nobody reports would otherwise quietly become permanent; instead it REDs `/ship`
  on every run until the register carries an `adjudicated(<date>)` or `fixed(<commit>)`
  line for that gate.

## Alternatives considered

1. **Gitignored `.claude/state` receipts** (matching the existing `last-green-sha`
   pattern) — rejected: this repo's containers are ephemeral by design (complaint #14,
   `docs/rules/harness.md` § Memory lifecycle), so a gitignored receipt dies with the
   container. Every fresh web session would then fail to find a receipt that genuinely
   existed moments earlier in another session, and would re-fire every gate regardless of
   whether review or QA actually happened.
2. **A committed receipts file** (e.g. `docs/receipts.json` tracking scope/hash/timestamp
   per gate) — rejected: this trades an ephemeral-state problem for a churn and
   trust problem. Every reviewed or QA'd change would need a second commit just to update
   the ledger, and the file is exactly as agent-writable as the commit trailer it would
   replace — it buys no additional integrity for a real ongoing maintenance cost.
3. **No gate at all; keep the review rail as CLAUDE.md prose** — rejected as the status
   quo, and the status quo is what this ADR responds to: prose the model already declared
   binding did not hold under load. "Advisory loses to the default" is the same finding
   ADR-033 made for blueprint-before-build; nothing about review makes it exempt.

## References

- `docs/blueprints/sdlc-chain.md` — the signed blueprint (stories, ACs, scenarios, the
  full work DAG, and twelve amendments recording the decisions folded in before sign-off).
- `docs/rules/harness.md` § The SDLC chain — the six-link table and cross-reference to the
  enforcement quartet.
- `docs/build-vs-buy-ledger.md`, 2026-08-22 entry — the nine adopted skills + the Tier-2
  routing-eval design, with the `Considered:` alternatives.
- `.claude/hooks/lib/receipt.mjs`, `.claude/hooks/review-gate.mjs`,
  `.claude/hooks/qa-gate.mjs`, `scanGateSkips()` in `scripts/ship.mjs` — the mechanism.
- ADR-047 — the fail-closed/fail-open split this ADR extends onto two new governance gates.
- ADR-032 / ADR-033 / ADR-034 — the enforcement-gate idiom this chain reuses a second time.
