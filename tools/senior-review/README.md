# Senior code review — portable, mandatory, cross-stack

A **post-push breadth review** that layers on top of fast pre-push checks. It
catches the four defect classes a diff gate structurally misses: cross-cutting
invariant gaps, adversarial/output-side trust boundaries, operational drift, and
architecture rot. (See ADR-020 for the why, and the analysis that motivated it.)

It is **stack-agnostic** by design — the three artifacts work unchanged in a
Next.js, Go, Python, Rails, or any other repo:

| Artifact                                 | What it is                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `.claude/agents/senior-code-reviewer.md` | The reviewer agent (the prompt + protocol).                            |
| `.github/workflows/senior-review.yml`    | Async CI gate: reviews PRs, posts findings, **never blocks the push**. |
| `AGENTS.md` mandate block                | The standing instruction making the review mandatory.                  |

## Where it sits in the review ladder (no redundancy, no delay)

```
edit ─▶ /ship (build·lint·test·secrets·audit)  ─▶ /code-review (fast DIFF gate)  ─▶ PUSH
                         pre-push, BLOCKING                  pre-push, BLOCKING
                                                                                  │
                                                                                  ▼
                                                   senior-code-reviewer (WHOLE-CHANGE breadth)
                                                        post-push, ASYNC, ADVISORY
```

- **`/ship`** and **`/code-review`** stay the pre-push gates (fast, blocking, diff-scoped).
- **senior-code-reviewer** runs _after_ push, asynchronously, and only _comments_
  — so it adds zero latency to the dev loop. It owns breadth + invariants +
  threat-model, which the diff gates don't.

## Install into another repo (any stack)

**From a checkout of this template:**

```sh
node scripts/install-senior-review.mjs --target /path/to/other/repo
```

This copies the agent + workflow and adds the mandate block to that repo's
`AGENTS.md` (idempotent — safe to re-run to pull updates).

**Manual (no template checkout):** copy these two files into the target repo and
paste the mandate block (between the `BEGIN/END senior-code-review` markers in
`scripts/install-senior-review.mjs`) into its `AGENTS.md`:

- `.claude/agents/senior-code-reviewer.md`
- `.github/workflows/senior-review.yml`

## Activate the CI gate

The workflow ships **dormant** (manual trigger only), matching this template's
other workflows so it doesn't fail-in-2s on a billing-blocked free plan. To turn
it on:

1. Set the repo secret **`ANTHROPIC_API_KEY`** (Settings → Secrets → Actions).
2. In `.github/workflows/senior-review.yml`, restore the `pull_request` + `push`
   triggers (commented at the top).

Until then, the in-session fallback applies: after pushing, invoke the
`senior-code-reviewer` agent on the change.

## Same-stack forks

Forks generated from this template receive the agent and installer automatically
via `/sync-from-template` (both live in OWNED layers: `.claude/agents`,
`scripts`). The CI workflow under `.github/workflows/` is not auto-synced — run
the installer once, or copy it, to pick it up.
