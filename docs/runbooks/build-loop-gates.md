# Runbook — the build-loop gates (receipts, blocks, skips)

**Answers:** my push just got rejected by something called a receipt gate — what is
this, what do I do, and how do I get out of it legitimately?

**Owner:** Operator · **Decision of record:** [ADR-064](../decisions/ADR-064-sdlc-chain.md)
· **Contract:** [`docs/blueprints/sdlc-chain.md`](../blueprints/sdlc-chain.md)

This runbook operates the **template's build loop**, not a deployment — the same
audience as [`maintainer.md`](./maintainer.md) at its edges, but you need it the
first time a gate says no, which is usually week one.

---

## 1. The one idea

A step whose only output is text in the transcript **cannot gate anything, and will
eventually be skipped.** That is a design defect, not a discipline defect, and it was
this template's: `CLAUDE.md` called review "binding" while no hook enforced it.

So every gated step now emits a **receipt** — a git trailer on a commit — and the
next step refuses to run without it. Receipts are durable (they live in git history,
not in a session), content-bound (they name the exact tree they certify), and
self-invalidating (change the code and the receipt stops matching).

```
/review ──emits──> Reviewed: <scope> <tree-sha> ──read by──> review-gate (pre-push)
/qa     ──emits──> QA:       <scope> <tree-sha> ──read by──> qa-gate     (pre-deploy)
```

Two gates, two receipts. That is the whole mechanism.

---

## 2. The receipts

| Receipt     | Written by | Read by                               | Means                                                                                          |
| ----------- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Reviewed:` | `/review`  | `review-gate.mjs` (`.husky/pre-push`) | These paths passed a two-stage review (spec-compliance, then quality) at this exact content.   |
| `QA:`       | `/qa`      | `qa-gate.mjs` (PreToolUse on Bash)    | These paths passed the three QA tiers (design QA → functional QA → UAT) at this exact content. |

Both have the same shape:

```
Reviewed: lib/auth.ts app/api/users/route.ts 3f2a1c9e…
          └────────── scope ──────────────┘ └─ tree-sha ─┘
```

- **Scope** — the paths the step actually covered. Narrow receipts are normal and
  expected; `/qa`'s re-run scoping encourages them.
- **Tree-sha** — a hash over the _content_ of exactly those paths. This is what makes
  the receipt honest. A rebase that resolves conflicts keeps the commit message but
  changes the code; without the hash the receipt would go on certifying code nobody
  reviewed. With it, the receipt self-invalidates and the gate says "stale, re-run".

You never hand-write these. The skills emit them, and if you need the value yourself:

```bash
node .claude/hooks/lib/receipt.mjs trailer --key Reviewed lib/auth.ts app/api/users/route.ts
node .claude/hooks/lib/receipt.mjs verify  --key QA .
```

### A valid receipt is not automatically a sufficient one

`qa-gate` requires the receipt to **cover what ships** — whole-tree, or every shipping
path changed since the last QA'd commit. A perfectly valid `QA: package.json <sha>`
does not unlock a full production deploy. (It used to. That was a HIGH finding.)

---

## 3. What a blocked push looks like

`review-gate` runs in `.husky/pre-push`, **after** `npm run ship`, so a red build
still fails first. When it rejects, you get this on stderr and the push does not
happen:

```
[review-gate] PUSH REJECTED — these changed paths are in the gated review scope and
carry no valid review receipt:
    lib/auth.ts
    app/api/users/route.ts

  CLAUDE.md makes review BLOCKING for auth files, prisma/schema.prisma, app/api/** and lib/**.
  Fix: run /review (two-stage: spec-compliance, then quality). On a clean review it writes
       Reviewed: <scope> <tree-sha>
  as a git trailer on the commit; this gate reads that trailer. You can compute the value with
       node .claude/hooks/lib/receipt.mjs trailer --key Reviewed lib/auth.ts app/api/users/route.ts

  Deliberate skip (hotfix): add a trailer
       Gate-Skip: review-gate <reason>
  …
```

**The normal response is to run `/review`.** That is not a formality you are being
made to perform — the gate fires precisely on the surfaces (`auth`, schema, routes,
`lib/`, and the harness itself) where an unreviewed change is expensive.

If a receipt is present but **stale**, the message says so and prints both hashes.
Stale means the reviewed paths changed after review — a rebase, an amend, or a later
edit. Re-run `/review`; do not try to reuse the old trailer.

### What is in scope

Review scope is a **safe-set denylist**, not an allowlist: everything is gated
_except_ `docs/**`, `.claude/skills/**`, `README.md`, `CHANGELOG.md`, `messages/**`,
`public/**` and `design/**`. It was an allowlist until an allowlist missed a
gate-disabling file three reviews running. `docs/findings-register.md` is gated even
though it lives under `docs/` — it is the trust anchor every other escape hatch reads.

`qa-gate` matches real deploy invocations (`npm run deploy`, `node scripts/deploy.mjs`,
`vercel deploy`, `vercel --prod`) and deliberately **not** `git push` — Vercel
auto-builds on push, and that is exactly `/quickstart`'s path.

---

## 4. Getting out legitimately

There are three exits. Use them in this order.

### (a) Do the step

Run `/review` or `/qa`. Almost always the right answer, and usually faster than
reasoning about the alternatives.

### (b) `/quickstart` exemption — disposable work only

A commit carrying the **fixed** trailer

```
Quickstart: exempt
```

exempts the push (review-gate) and the deploy (qa-gate). It preserves the ~10-minute
idea-to-URL promise for throwaway prototypes, and it is deliberately awkward to reach
for on real work.

Three properties, each of which is a fixed bug:

- It is a **trailer**, not an env var — an ambient `export QUICKSTART=1` disabled a
  binding control for every later push from that shell, with nothing in git to show.
- It is a **fixed literal** — a docs commit whose last line was a well-formed _example_
  trailer once exempted a real gated change. `Quickstart: disposable prototype` does
  not match. Only `Quickstart: exempt` does.
- It is read from the **trailer block** (`git interpret-trailers --parse`), so quoting
  the token in prose — as this runbook does — cannot exempt anything.

### (c) `Gate-Skip:` — the recorded acknowledgement

Real hotfix pressure exists. Add a trailer to a commit in the push:

```
Gate-Skip: review-gate production is down, auth hotfix, reviewing after
Gate-Skip: qa-gate    customer demo in 20 minutes
```

The gate then allows the operation and prints a loud, unmissable banner. **This is not
a quiet bypass.** Three things happen:

1. The skip is permanent in git history. It cannot be walked back.
2. `npm run ship` turns **RED** — its `gate-skips` check scans `origin/main..HEAD`, not
   just unpushed commits, so pushing the skip does not make it go away. It stays red
   until the work merges or you adjudicate it.
3. Adjudicating means a dated line in `docs/findings-register.md` (§5).

That RED is the point. A recorded skip nobody reads is an unrecorded skip.

> **Not an exit:** `git push --no-verify`. It bypasses `npm run ship` and both gates at
> once, leaves nothing behind, and is the one move this runbook asks you not to make.
> If you are reaching for it, `Gate-Skip:` gives you the same unblock with a receipt.

---

## 5. Adjudicating a skip in the findings register

`docs/findings-register.md` is where "we decided not to fix this" becomes a reviewable
decision instead of a shrug. One line, newest at the top:

```
YYYY-MM-DD — [pillar/area] <finding> — WHY waived — <owner> — status: open | adjudicated(<date>) | fixed(<commit>)
```

To clear a `Gate-Skip:` RED, the entry must **name the gate** and carry a terminal
status:

```
2026-08-22 — [secure/harness] Gate-Skip: review-gate on the auth hotfix — production was
down; the change is a one-line session-expiry fix, reviewed post-hoc and clean —
Tariq — status: adjudicated(2026-08-22)
```

`status: open` does **not** clear it — that is the whole design. Only
`adjudicated(<date>)` or `fixed(<commit>)` do.

Two rules that catch people:

- **`fixed(<commit>)` must name a resolvable SHA** that `git show` can find. Not
  `fixed(this commit)`, not `fixed(this branch)` — those are unverifiable the moment
  anyone reads the register from a later commit.
- **Security suppressions go in `SECURITY.md` §12, not here.** This register is for the
  four non-security pillars, UX judgment calls, skipped QA phases and deferred work.

---

## 6. When a gate misbehaves

These are **governance gates**, and per [ADR-047](../decisions/ADR-047-ws8-harness-hardening.md)
they **fail open**: a malformed input, a git failure, a detached HEAD, any throw at
all → the operation is allowed, with a warning naming the gate that failed.

That is deliberate, and it is the opposite of the security guards
(`protect-secrets`, `dangerous-commands`, `bash-write-gate`), which fail **closed**.
A broken governance gate must never wedge a session; a broken security guard must
never let something through. "Cannot evaluate" and "evaluated, the answer is no" are
different axes — a _missing receipt_ still hard-denies.

So: **if you see a fail-open warning, the gate is broken, not satisfied.** Fix it —
that is `maintainer.md`'s territory — and do not treat the allowed push as reviewed.

### Turning a link off

Each gate is one file plus one registration, so either can go without touching the
other:

| Link          | Off switch                                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| `review-gate` | comment out the `node .claude/hooks/review-gate.mjs` line in `.husky/pre-push` |
| `qa-gate`     | remove its entry from the `Bash` matcher in `.claude/settings.json`            |

Turning one off is a harness change like any other: it is in the gated review scope,
so it needs its own `Reviewed:` receipt. That is not circular — it means disabling a
gate is a reviewed act rather than a quiet one.

---

## 7. Fast reference

```bash
# What does the chain think the state is right now?
/router

# Compute a receipt value by hand
node .claude/hooks/lib/receipt.mjs trailer --key Reviewed <paths...>
node .claude/hooks/lib/receipt.mjs verify  --key QA .

# Is anything unadjudicated?
npm run ship          # the gate-skips check goes RED and names the commit
```

| Symptom                                   | Read                    |
| ----------------------------------------- | ----------------------- |
| "PUSH REJECTED … no valid review receipt" | §3, then run `/review`  |
| "receipt IS present but its tree-sha …"   | §2 — stale, re-run      |
| "Denied: this is a deploy invocation …"   | §3, then run `/qa`      |
| "GATE SKIPPED (recorded acknowledgement)" | §5 — adjudicate it      |
| "[gate] failed at stage … allowing"       | §6 — the gate is broken |

---

## Related

- [ADR-064](../decisions/ADR-064-sdlc-chain.md) — why receipts, why hard-deny, why fail-open
- [ADR-047](../decisions/ADR-047-ws8-harness-hardening.md) — the guard/gate split
- [`docs/rules/harness.md`](../rules/harness.md) — the chain table and the `/ship` roster
- [`maintainer.md`](./maintainer.md) — evolving the gates without weakening the floor
- [`docs/findings-register.md`](../findings-register.md) — where adjudications land
