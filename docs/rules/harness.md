---
globs: .claude/**, eslint-rules/**, scripts/**, tests/**, Makefile
title: Harness — gates, ESLint roster, agents, token policy, commands
---

# Harness rules (binding)

Loaded lazily when you touch the harness (`.claude/**`, `eslint-rules/**`, `scripts/**`, tests).
**This file is the binding rules only.** The reference material behind them — the full ESLint
rationale, the warm-vs-full gate tables, the shadow-DB recipe, the memory-lifecycle history, the
parallel-by-default mechanism detail, the full command list — lives in
**`docs/runbooks/maintainer.md` § Harness reference**. Read that when you need the detail; nothing
was deleted in the split.

## Agents & tier routing (ADR-022)

Route work to the tier that fits (`docs/ARCHITECTURE.md`): **scout** (haiku — read-only
investigation) · **senior-code-reviewer** (sonnet — post-push breadth) · **security-architect**
(opus — threat model / trust boundaries / data classification) · **sre** (sonnet — operational
readiness). Read access to `.next/`, `node_modules/`, `generated/` is denied — work from source.

**Every wildcard in `permissions.allow` is a capability grant (red-team R2).** A wildcard over a CLI
grants every subcommand that CLI will ever have — `Bash(npx prisma *)` silently granted
`migrate reset` (drops the database) and `db execute` (arbitrary SQL). The allowlist is verb-scoped:
prisma to `generate` / `migrate dev|deploy|status` / `studio` / `db seed`; `find` to read-only forms;
`git push` to `claude/*` refspecs; `docker compose down` without flags. The destructive verbs are
deny-listed **and** covered semantically in `dangerous-commands.mjs`, because the deny-list is
prefix-lexical and prefix patterns alone are not a control. **When you add an allow entry, add the
matching semantic check** — that pairing is the rule the original design missed.

## Review rail — two-stage, binding (ADR-020, V2-206)

Both the pre-push `/code-review` diff gate and the post-push `senior-code-reviewer` run **STAGE 1
spec-compliance BEFORE STAGE 2 code-quality**. Stage 1 maps every changed file to a covering
blueprint `Scope:`: a changed gated file (`app/api/**/route.ts`, `app/**/page.tsx`, `lib/**`)
outside every covering Scope is a **Stage-1 finding** (High), as is diff behavior contradicting a
story/AC. A flawless-but-wrong change fails Stage 1 and never reaches the quality lenses. Stage 1
leads the report (or an explicit "Stage 1 clean" line). Preferred runner is CI
(`.github/workflows/senior-review.yml`, dormant); when CI is off, invoke the agent in-session
before calling the work done. (Build-time note: the React Compiler Babel pass, ADR-048, adds ~10s
to `/ship`'s build.)

## Token thrift (binding; policy: `docs/ARCHITECTURE.md`, ADR-019)

- Delegate repo-wide searches to **scout**; don't read >5 files inline for orientation.
  `docs/REPO-MAP.md` answers "where is X" for free.
- Concise output; targeted edits over rewrites; read a file once unless it changed.
- When compacting, preserve: modified-file list, last `/ship` status, open findings, operator goal.
- Long session → `/handoff-session` at the next milestone; repetitive N-file jobs → `/batch`.
- Durable knowledge → `docs/agent-memory.md` via `/remember` (ADR-022).

## Parallel-by-default (binding, V2-104)

Decompose every multi-part task. ≥2 **write-disjoint** units → dispatch as parallel subagents in a
**single message**, unprompted. **File-ownership sets are mandatory** (explicit, disjoint; overlap →
serialize). Dependency chains do NOT parallelize. The main session is **orchestrator-only** during a
wave. Verify each returned unit, then run **ONE** `/ship` over the combined result. Enforcement
mechanism is `/fan-out` (ADR-057): `check-overlap` refuses to dispatch on overlap, `verify-scope`
confirms every changed file landed in exactly one declared set.

## Memory lifecycle (binding)

- **In-flight state** (`docs/SESSION-HANDOFF.md`, `docs/session-state.json`) is **gitignored, local
  to the machine, never committed anywhere.** It dies with the container by design; SessionStart
  regenerates a skeleton (V2-006). Anything worth keeping goes to `docs/agent-memory.md` — that is
  the answer to "but I need this next session", not a commit of these files.
- **Work a past session appears to have lost is usually an unpushed commit, not lost access.**
  Check `git log --all`, `git reflog` and the remote branches before concluding anything —
  **recover it, don't claim "no access."**
- The `Stop` hook **hard-blocks** turn-end on **unpushed commits**; uncommitted WIP is a warning only.
- Close call on blast radius → default to `EnterPlanMode` **and name the trigger** that justified it.

## The enforcement quartet — mechanism (CLAUDE.md states the rule)

**They are PROCESS, not controls (red-team R6).** Two of them (`build-vs-buy-gate.mjs`,
`blueprint-gate.mjs`) fail **OPEN** by ADR-047 design — malformed input returns allow, verified by
feeding them non-JSON — so a corrupted ledger silently switches the gate off. And the artifact each
one checks is **agent-writable**: an agent blocked by build-vs-buy can write its own `Considered:`
entry and proceed. That is intended, but it means these gates **prompt deliberation; they cannot
stop a determined change** (evidence: 42 ledger entries, zero reversals). Treat them as process
documentation with a blocking UI. What actually holds is the security floor — auth wrappers, zod at
the boundary, the ESLint rules, the audit log, gitleaks, and the fail-CLOSED guards
(`dangerous-commands`, `protect-secrets` — those two only; `bash-write-gate` sits beside them
on the Bash matcher but is fail-OPEN by its own header and an empty catch, so an internal
error there ALLOWS the write).

Each gate **denies/REDs** until its committed adjudication artifact exists; recording the artifact
IS the scan, not a bypass. Artifacts: build-vs-buy → a `docs/build-vs-buy-ledger.md` entry whose
`Scope:` covers the file AND carries a `Considered:` line naming ≥1 real alternative (scan step 0 is
`docs/oss-catalog.md`); blueprint → a covering `docs/blueprints/<feature>.md` `Scope:`; complexity →
`complexityAck` + an adjudicated `docs/findings-register.md` line. Hooks: `build-vs-buy-gate.mjs`,
`blueprint-gate.mjs`, and `bash-write-gate.mjs` (Bash writes to gated paths are covered too).

## The SDLC chain — mechanism (ADR-064; extends the quartet above)

Six links, each the same shape as the quartet above: a step emits a durable token, the
next step's gate requires it. Links 1 and 3 predate ADR-064; links 2, 4, 5 and 6 are its
subject. Full context (problem, hash algorithm, alternatives): ADR-064.

| Link                     | Emits                                                                    | Enforced by                                                      | Status                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| blueprint → code         | committed `Scope:` glob (`/blueprint`)                                   | `blueprint-gate.mjs` (PreToolUse, ADR-033)                       | fail-open guard, hard-deny on missing scope                                                                             |
| code → review → push     | `Reviewed: <scope> <tree-sha>` trailer (`/review`)                       | `review-gate.mjs` (`.husky/pre-push`, after `npm run ship`)      | fail-open guard, hard-deny on missing/stale receipt                                                                     |
| ship green → push        | `last-green-sha` state token (`/ship`)                                   | `.husky/pre-push`                                                | pre-existing, unchanged by ADR-064                                                                                      |
| qa → deploy              | `QA: <scope> <tree-sha>` trailer (`/qa`)                                 | `qa-gate.mjs` (PreToolUse on `Bash`, matches deploy invocations) | fail-open guard, hard-deny on missing/stale receipt; `/quickstart` exempt by design                                     |
| push → session end       | unpushed ref (any commit not on `@{u}`)                                  | `session-stop.mjs` (Stop hook)                                   | pre-existing, unchanged by ADR-064                                                                                      |
| gate-skip → adjudication | `Gate-Skip: <gate> <reason>` trailer (recorded ack on either gate above) | `scanGateSkips()` in `scripts/ship.mjs` (warm loop)              | new; REDs `/ship` until a `docs/findings-register.md` entry for that gate reads `adjudicated(<date>)`/`fixed(<commit>)` |

Both new gates (`review-gate.mjs`, `qa-gate.mjs`) share `.claude/hooks/lib/receipt.mjs`:
the trailer's tree-sha is computed over the CURRENT content of its own scope (a temporary
git index holding only the in-scope paths at their blobs, then `git write-tree`), so a
rebase or amend that changes a reviewed/QA'd path invalidates the receipt instead of
letting it certify content nobody looked at. Same fail-open/fail-closed split as the
quartet: a hook that **cannot evaluate** the request (malformed input, a git failure) fails
OPEN with a warning; a hook that evaluates fine and finds **no valid receipt** hard-DENIES
— those are different axes, not one blurred posture (ADR-047, ADR-064). Per-link backout:
each gate is one file plus one invocation line, removable independently of the others.

The review gate's scope is `lib/**`, `app/api/**`, `prisma/schema.prisma`, `middleware.ts`,
`auth.ts`, `auth.config.ts`, **plus `.claude/hooks/**` and `scripts/**`** — widened after
this chain's own wave shipped three hooks and a receipt library with no review receipt,
because harness code carries at least the blast radius of `lib/**` (it can switch a
fail-closed guard off, and `scripts/ship.mjs` is itself a gate).

**Known limitation, stated plainly (ADR-064):** the trailer can be scoped narrower than
what actually changed — `/review` certifies whatever paths it's told to, nothing forces
that set to equal the full diff. Same agent-writable caveat the quartet above already
carries: the receipt is a governance record, not a proof.

`/ship`'s warm loop is now **21 checks** (up from 19): `scanGateSkips()` is new, and the
Tier-2 routing eval (`evals`, `--min-rank1 80`) moved from `ship:full` into the warm loop
— at ~326ms against a ~65s run, keeping it `fullOnly` meant a routing regression could
survive every ordinary push, which defeats a ratchet meant to catch exactly that.

## Project tiers — mechanism

`/ship` enforces tier-vs-reality: ≥2 distinct human contributors (the same line that activates CI)
while `project.config.json` `"tier"` is still the `personal` default **fails**. Fix with
`"tier": "shared"`, or record `"tierAck": "personal"` if it is genuinely still personal.

## ESLint floor (`eslint-rules/`, thirteen rules, all at `error`)

`no-prisma-in-client` · `no-any-cast-on-session` · `no-secret-env-in-console` ·
`no-bare-internal-route` · `no-raw-hex-color` (ADR-015) · `no-unaudited-bulk-write` (ADR-010) ·
`no-raw-sql-unsafe` · `no-rate-limit-inside-auth` · `no-restricted-export-column` ·
`no-prisma-unfiltered-import` · `no-direct-anthropic-sdk` (ADR-042) · `no-arbitrary-className` ·
`no-literal-jsx-text`. Plus the adopted `sonarjs/cognitive-complexity` at `error` (threshold 25) on
the product surfaces. Justified suppression = a **single-line** disable; if security-related, log it
in SECURITY.md §12. Per-rule rationale: `docs/runbooks/maintainer.md` § Harness reference.

## Gates & commands

`npm run ship` is the **warm** loop (~60–80s, DB-free) — what "run `/ship` before every push" means.
`npm run ship:full` adds docker+trivy, BDD traceability, integration-vs-real-Postgres, and the SBOM
license gate; it runs in `/deploy`, `/handoff`, CI. **Warm green never implies the integration
round-trips ran.** Full gate lists and the whole `npm run …` roster are in
`docs/runbooks/maintainer.md` § Harness reference.

## Known traps (don't "fix")

- After large route deletions a stale `.next` breaks typecheck with TS2307 — `npm run ship` auto-heals.
- The rule files live in `docs/rules/`, NOT `.claude/`: anything under `.claude/` is auto-loaded into
  every session, which would make these lazy files an always-on tax. Do not move them back.

## Ask before (harness surface)

Touching `eslint-rules/`; disabling any `rihal-template/*` rule beyond a single-line disable;
suppressing a Semgrep/gitleaks/npm-audit finding (log in SECURITY.md §12); changing the ADR-001
locked stack (write a superseding ADR first); **editing `.claude/settings.json`'s
`permissions.allow`/`permissions.deny` arrays** — widening what an autonomous agent may run without
a human in the loop is security-sensitive (V2-107): get explicit operator sign-off and note it in
`docs/findings-register.md`. The semantic backstop under the lexical deny-list is
`dangerous-commands.mjs` (fail-closed) — extend IT, don't rely on prefix patterns alone.

## knip scope — why `components/ui/**` is excluded (B2, 2026-08-17)

`knip.json` used to declare `lib/**`, `components/shared/**`, `components/ui/**` and `hooks/**`
as **entry points**. An entry point is reachable by definition, so the dead-code gate was
**structurally incapable** of reporting dead code in the two directories where it accumulates.
Proven by differential run: as shipped it reported nothing; with those globs removed it reported
5 unused files, an unused dependency and 31 unused exports.

`lib/**`, `components/shared/**` and `hooks/**` are now honestly checked. `components/ui/**` is
**ignored instead**, and the distinction matters:

- it is **vendored shadcn/ui**, not first-party code;
- its export completeness is the _point_ — a fork building a form will want `CardFooter`,
  `DialogDescription`, `SelectLabel`. Pruning to current usage would gut the kit and force every
  fork to re-add parts by hand;
- so this is an **explicit, reasoned exclusion**, not the blanket blindness B2 removed.

The rationale lives here because `knip.json` is schema-validated and rejects a `$comment` key.

**If you add a vendored library elsewhere, ignore it the same way — but never re-add `lib/**` or
`components/shared/**` to `entry`.** That is the blindness, and it read green for a long time.

### Resolved 2026-08-21 — how the 27 findings were closed

That mix is now separated at the DEFINITION SITE rather than by widening the gate's blind spots:

- **Deliberate fork-facing API** carries a `@public` TSDoc tag, and `knip.json` sets
  `"tags": ["-public"]`. Same reasoning as the `components/ui/**` exclusion above — a fork
  building a dashboard wants `LineChart`, `EditIcon`, `idParamSchema`, `CreateUserInput` —
  but scoped to the individual export instead of a whole directory, so nothing else in that
  file goes unchecked. The tag sits next to the thing it describes, so it is visible to
  whoever next edits it.
- **Three were not dead code at all**, only dead _exports_: `entityKeys`, `auditStorage` and
  `recipientLabel` are each used inside their own module. They are now module-private. For
  two of them the export was an active liability: a caller holding the raw `auditStorage`
  `AsyncLocalStorage` could `.run()` an unbounded context past the bounding its wrappers
  apply, and `recipientLabel` offered outside callers a formatter for recipient data when
  the point of it is that this file logs a COUNT and never an address.
- **One was genuinely dead:** `__resetLockoutForTests`, a test seam no test ever called.
  Deleted.

**When you add a fork-facing export, tag it `@public` in the same commit.** Untagged and
unreferenced means knip is right and the export should not exist.

One `Configuration hint` remains (`@stryker-mutator/command-runner` in `ignoreDependencies`).
Left deliberately: it is an OPTIONAL devDep the ship loop invokes only if installed, so the entry
is dormant rather than wrong, and knip exits 0 on hints — the gate keys on exit code. (`jscpd` was
on this list too until 2026-08-21, when installing it made the entry live and the hint went away
on its own — which is what a dormant entry is supposed to do.) Warm `/ship` is unaffected.
