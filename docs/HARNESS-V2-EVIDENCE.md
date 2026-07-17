# HARNESS-V2 — Evidence Manifest (Re-audit Contract)

This file is the re-audit contract defined in `HARNESS-V2-KICKOFF.md` §6. It is
maintained from the first commit of the program. The post-program re-audit walks this
table row by row: **an empty Evidence cell is a failed item regardless of the code.**

## Contract (KICKOFF §5–§6)

- An item is **done** only when its backlog acceptance criterion is demonstrated by a
  command output, test run, or captured transcript — never by assertion — and that
  evidence is linked here, and the work is committed `harness-v2(<ITEM-ID>): <summary>`
  and pushed.
- **Evidence** = a relative path to a test file, a captured command-output block in this
  file, a screenshot under `docs/verification/harness-v2/`, or a register/ledger line
  reference.
- **Negative tests are mandatory for every gate item**: prove the gate DENIES the bad
  case AND ALLOWS the good case.
- **Status** ∈ `pending` | `in-progress` | `done` | `deferred` | `superseded` | `blocked`.
  Deferred/blocked rows name the blocker and carry a `docs/findings-register.md` line.
  Superseded rows point at their successor ID.
- Only the operator adjudicates a findings-register line; the executor never marks one
  `adjudicated`.

_Item count: 48 (V2-001 … V2-507). All rows start `pending`._

## Manifest

| ID     | Phase | Status  | Commit(s) | Evidence                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ----- | ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-001 | 0     | done    | 32d1f9d   | [detail](#v2-001-evidence) · `tests/harness/hooks.test.mjs`                                                                                                                           | Bash write-gate: heredoc→new route DENIED, covered ALLOWED, `rm -rf` unchanged                                                                                                                                                                                                                                                                                               |
| V2-002 | 0     | done    | 32d1f9d   | [detail](#v2-002-evidence) · `tests/harness/hooks.test.mjs`                                                                                                                           | Scope-glob hygiene: over-broad+expired don't cover; specific does; existing pass                                                                                                                                                                                                                                                                                             |
| V2-003 | 0     | done    | 32d1f9d   | [detail](#v2-003-evidence) · `tests/harness/hooks.test.mjs`                                                                                                                           | Hook harness: 18/18 green; /ship phase-A `hooks`; mutation→RED demonstrated                                                                                                                                                                                                                                                                                                  |
| V2-004 | 0     | done    | 32d1f9d   | [detail](#v2-004-evidence)                                                                                                                                                            | Superpowers enabled + SessionStart presence check (both states shown)                                                                                                                                                                                                                                                                                                        |
| V2-005 | 0     | done    | 22baea3   | [detail](#v2-005-evidence)                                                                                                                                                            | Docs truth: AntD→shadcn/Radix; eleven rules; §15 test-flag corrected                                                                                                                                                                                                                                                                                                         |
| V2-006 | 0     | done    | 32d1f9d   | [detail](#v2-006-evidence)                                                                                                                                                            | session-state.json branch-only + SessionStart skeleton-regen; readers absence-tolerant                                                                                                                                                                                                                                                                                       |
| V2-101 | 1     | done    | (this)    | [detail](#v2-101-evidence) · `tests/harness/hooks.test.mjs` · `scripts/context-tax.mjs`                                                                                               | Constitution 25098→8184B (≤8KB); always-on 36868→19954B (≤20KB); lazy `.claude/rules/*.md` via `rules-injection.mjs`; mapping table below (zero loss)                                                                                                                                                                                                                        |
| V2-102 | 1     | done    | (this)    | [detail](#v2-102-evidence) · `tests/harness/hooks.test.mjs` · `scripts/memory-digest.mjs`                                                                                             | agent-memory → ≤30-line SessionStart digest + themed ≤60-line sections; `npm run memory-digest` budget check; memory surface 3898→2763B (tax 19288B)                                                                                                                                                                                                                         |
| V2-103 | 1     | done    | (this)    | [detail](#v2-103-evidence) · `tests/harness/hooks.test.mjs` · `scripts/hook-latency.mjs`                                                                                              | Pillar 1 → "Speed & Velocity" (constitution + rubric); 3 advisory checks (context-size, /ship wall-time, hook-latency) fire on synthetic regressions; baselines in `project.config.json`                                                                                                                                                                                     |
| V2-104 | 1     | done    | (this)    | [detail](#v2-104-evidence)                                                                                                                                                            | Binding constitution line + full mechanism in `harness.md`; demonstrated by dispatching V2-106+V2-107 as a parallel disjoint subagent pair (git-diff provenance)                                                                                                                                                                                                             |
| V2-105 | 1     | done    | (this)    | [detail](#v2-105-evidence) · `docs/decisions/ADR-057-parallel-execution-mechanism.md` · `.claude/skills/fan-out/SKILL.md` · `scripts/fan-out.mjs`                                     | ADR-057 written (native recommended); operator ASK verdict = **custom**; built `/fan-out` — manifest overlap-refusal (`check-overlap`) + post-wave scope-verify (`verify-scope`) over native dispatch; 5 hook tests green                                                                                                                                                    |
| V2-106 | 1     | done    | (this)    | [detail](#v2-104-evidence) · `docs/build-vs-buy-ledger.md`                                                                                                                            | `npm run tokens` (ccusage via npx, per-session/model spend); LEDGER entry; ADR-054 budget-line note; verified `$112.53`/136.5M-token report from local logs                                                                                                                                                                                                                  |
| V2-107 | 1     | done    | (this)    | [detail](#v2-104-evidence) · `.claude/settings.json`                                                                                                                                  | Deny-list: allow the safe `git branch -d` (force `-D`/force-push/reset/clean/`--amend` still denied); `--amend` unpushed-only not matcher-expressible                                                                                                                                                                                                                        |
| V2-201 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/benchmark/**` · `docs/benchmarks/it-asset-management.md`                                                                                 | `/benchmark` skill (parallel Wave 1); ITAM matrix mined from Snipe-IT (12 table-stakes/9 diff/5 anti, sourced)                                                                                                                                                                                                                                                               |
| V2-202 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/blueprint/SKILL.md` · `scripts/lib/blueprint-content.mjs`                                                                                | Feature-parity section + `/ship` blueprint-content warn (shared: block); unit-tested; synthetic missing-section reds                                                                                                                                                                                                                                                         |
| V2-203 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/blueprint/SKILL.md`                                                                                                                      | Universal app-floor checklist section; pilot blueprint uses it (per-list/entity/app, floors pre-marked)                                                                                                                                                                                                                                                                      |
| V2-204 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/explore/**` · `docs/decisions/ADR-059-*.md`                                                                                              | `/explore` skill (parallel Wave 1); pilot run produced the pillars trade-off + ADR-059 losers stub                                                                                                                                                                                                                                                                           |
| V2-205 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/blueprint/SKILL.md`                                                                                                                      | Work-graph DAG (P/S + file-ownership + role-lens) in blueprint; Wave 1 executed in parallel via `/fan-out` (verify-scope clean)                                                                                                                                                                                                                                              |
| V2-206 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/agents/senior-code-reviewer.md`                                                                                                                 | Two-stage review: Stage 1 spec-compliance (Scope+story) before Stage 2 quality; pilot review ran both stages                                                                                                                                                                                                                                                                 |
| V2-207 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `docs/decisions/ADR-058-*.md` · `scripts/bdd-coverage.mjs`                                                                                               | ADR-058 (Proposed, ASK) + ledger; owned `bdd-coverage` gate; pilot US1-US4 covered; delete-a-step-def→red verified                                                                                                                                                                                                                                                           |
| V2-208 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/retro/**`                                                                                                                                | `/retro` skill (parallel Wave 1); phase retros in this file; omission→benchmark feedback path                                                                                                                                                                                                                                                                                |
| V2-209 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `.claude/skills/blueprint/SKILL.md` · `scripts/lib/blueprint-content.mjs`                                                                                | Amendment delta block + `Confirmed:` marker; `/ship` amended-unconfirmed warn (shared: block); unit-tested                                                                                                                                                                                                                                                                   |
| V2-210 | 2     | done    | (this)    | [detail](#v2-2xx-evidence) · `docs/blueprints/asset-tracker.md` · `app/api/asset/**`                                                                                                  | Pilot Asset Tracker ran the WHOLE loop (benchmark→explore→blueprint→scaffold+invariant→BDD→review→ship→retro); mergeable, /ship green                                                                                                                                                                                                                                        |
| V2-301 | 3     | done    | (this)    | [detail](#v2-301-evidence) · `scripts/capture-screens.mjs` · `.claude/rules/design.md` · `docs/verification/asset-tracker/`                                                           | Visual-iteration loop: capture harness (`npm run capture`) + binding rule + `/design-qa` during-build mode; real before/after on the Asset Tracker (loop caught raw-enum copy defect → humanized labels), captures + critique committed                                                                                                                                      |
| V2-302 | 3     | done    | d73232c   | `components/shared/PageShell.tsx` · `StatGrid.tsx` · `FormLayout.tsx` · `docs/build-vs-buy-ledger.md` · `docs/design-recipes.md` §1c                                                  | Layout primitive layer: 3 token-scale, RTL-safe composition wrappers (build 3 missing, reuse the 6 shipped); ledger adjudication; compose-first recipe                                                                                                                                                                                                                       |
| V2-303 | 3     | done    | 5876859   | `app/[locale]/(dashboard)/style-guide/page.tsx` · `docs/design-recipes.md` §1d · `docs/design-references.md`                                                                          | Page archetypes: 5 canonical archetypes + density rule; style-guide "Page archetypes" demo section (Dashboard/Detail/Form/List/Settings) on the shipped primitives                                                                                                                                                                                                           |
| V2-304 | 3     | done    | (this)    | [detail](#v2-304-evidence) · `eslint-rules/rules/no-arbitrary-className.mjs` · `docs/verification/v2-304-lint/` · `docs/build-vs-buy-ledger.md`                                       | Spacing/typography lint: 12th local rule (scoped to spacing p/m/gap/space + font-size text-[…px]) at `error` on JSX/TSX; RuleTester-covered; 3 pre-existing hits resolved (1 on-scale, 2 justified escape-hatch); visual loop confirmed                                                                                                                                      |
| V2-305 | 3     | done    | (this)    | [detail](#v2-305-evidence) · `eslint-rules/rules/no-literal-jsx-text.mjs` · `scripts/copy-check.mjs` · `messages/en.json` · `docs/build-vs-buy-ledger.md`                             | Copy chokepoint: 13th ESLint rule routes literal JSX text/attrs → next-intl (product code lands at 0 violations; dev-page/root-boundary/test exempt); `/ship` `copy` gate holds source-locale copy to house style (sentence case, no trailing period, terminology); 22 Title-case labels migrated; planted-literal + "Submit Request." both fail; RuleTester + harness tests |
| V2-306 | 3     | done    | (this)    | [detail](#v2-306-evidence) · `docs/oss-catalog.md` · `.claude/skills/adopt/SKILL.md` · `docs/decisions/ADR-060-*.md`                                                                  | OSS catalog (feature-oracle products + capability adopt-or-build table) + `/adopt` skill (catalog lookup → AskUserQuestion trade-off → ledger + ADR stub → install); both build-vs-buy gate deny messages name the catalog as step 0; demoed on rich-text-editor (ADR-060 + ledger "entry ahead of build")                                                                   |
| V2-307 | 3     | done    | e338a37   | `docs/design-references.md` · `.claude/rules/design.md` (10-point rubric)                                                                                                             | Taste anchors (Linear/Vercel/Stripe + additions) per archetype; the numeric 0/1 10-point rubric wired into the visual loop + `/design-qa`; cite anchor+capture per deduction                                                                                                                                                                                                 |
| V2-308 | 3     | done    | (this)    | [detail](#v2-308-evidence) · `scripts/visual-regression.mjs` · `tests/harness/visual-regression.test.mjs` · `docs/verification/v2-305-copy/baseline/` · `docs/build-vs-buy-ledger.md` | Visual regression: `pixelmatch`+`pngjs` differ over the capture set (build vs Lost Pixel/Argos — ledger); committed baseline; `npm run visual-regression` wired to `/design-qa`/`uat:full` (NOT warm `/ship`); a 4px misalignment → red diff proven by unit test (4/4) + a real CLI baseline-vs-identical pass (exit 0)                                                      |
| V2-309 | 3     | done    | (this)    | [detail](#v2-309-evidence) · `.claude/hooks/lib/scope-cover.mjs` · `.claude/hooks/build-vs-buy-gate.mjs` · `tests/harness/hooks.test.mjs`                                             | Build-vs-buy completeness: gate surface widened from `lib/**` to also `components/shared/**` + `scripts/**` (same exclusions); a covering ledger entry must now carry a `Considered:` line (bare Scope = rubber stamp). Both gate paths + deny messages updated; 4 negative tests (deny new shared/scripts, allow Considered-bearing, deny bare-Scope, exclude .test) green  |
| V2-401 | 4     | pending | —         | —                                                                                                                                                                                     | Testcontainers + /ship --full (LEDGER)                                                                                                                                                                                                                                                                                                                                       |
| V2-402 | 4     | pending | —         | —                                                                                                                                                                                     | pgvector verification                                                                                                                                                                                                                                                                                                                                                        |
| V2-403 | 4     | pending | —         | —                                                                                                                                                                                     | Coverage floor                                                                                                                                                                                                                                                                                                                                                               |
| V2-404 | 4     | pending | —         | —                                                                                                                                                                                     | Cognitive complexity at error (LEDGER)                                                                                                                                                                                                                                                                                                                                       |
| V2-405 | 4     | pending | —         | —                                                                                                                                                                                     | Mutation testing on invariants (LEDGER)                                                                                                                                                                                                                                                                                                                                      |
| V2-406 | 4     | pending | —         | —                                                                                                                                                                                     | Invariant unit tests                                                                                                                                                                                                                                                                                                                                                         |
| V2-407 | 4     | pending | —         | —                                                                                                                                                                                     | Local security fallbacks (LEDGER)                                                                                                                                                                                                                                                                                                                                            |
| V2-408 | 4     | pending | —         | —                                                                                                                                                                                     | protect-secrets scope honesty                                                                                                                                                                                                                                                                                                                                                |
| V2-409 | 4     | pending | —         | —                                                                                                                                                                                     | Debt sunset                                                                                                                                                                                                                                                                                                                                                                  |
| V2-501 | 5     | pending | —         | —                                                                                                                                                                                     | ADR-056 decision (ASK, ADR)                                                                                                                                                                                                                                                                                                                                                  |
| V2-502 | 5     | pending | —         | —                                                                                                                                                                                     | Renovate (LEDGER)                                                                                                                                                                                                                                                                                                                                                            |
| V2-503 | 5     | pending | —         | —                                                                                                                                                                                     | Skill-standard conformance                                                                                                                                                                                                                                                                                                                                                   |
| V2-504 | 5     | pending | —         | —                                                                                                                                                                                     | Docs-currency skill                                                                                                                                                                                                                                                                                                                                                          |
| V2-505 | 5     | pending | —         | —                                                                                                                                                                                     | Doctrine sync + maintainer runbook                                                                                                                                                                                                                                                                                                                                           |
| V2-506 | 5     | pending | —         | —                                                                                                                                                                                     | Fork doc-payload manifest                                                                                                                                                                                                                                                                                                                                                    |
| V2-507 | 5     | pending | —         | —                                                                                                                                                                                     | Program closeout                                                                                                                                                                                                                                                                                                                                                             |

## Phase 0 evidence detail

All captures are real hook/command invocations (KICKOFF §5). Reproduce the gate cases with the
committed suite: `npm run test:hooks` (18/18). Negative test for every gate item included.

### V2-001 evidence

Bash write-gate closes the shell bypass. Real hook invocations (`.claude/hooks/bash-write-gate.mjs`):

```
CASE 1  heredoc -> NEW uncovered app/api/secretbackdoor/route.ts   decision: deny
        reason: "[blueprint-gate] Denied (via bash-write-gate): the shell command writes
        'app/api/secretbackdoor/route.ts', new feature code with no blueprint covering it …
        Dropping to Bash does not bypass the gate."
CASE 2  heredoc -> COVERED app/api/openapi/route.ts (openapi blueprint)   decision: (none) => ALLOWED
CASE 3  dangerous-commands rm -rf /  (must be UNCHANGED)   decision: deny
```

Negative test: DENIES the bad case (uncovered new route), ALLOWS the good case (covered route),
and the fail-closed `rm -rf` denial is unchanged. Also covered in the suite: `tee`/`cp` into gated
surfaces DENY; writes outside gated surfaces ALLOW; fail-open on malformed stdin.

### V2-002 evidence

Blueprint Scope-glob hygiene (`.claude/hooks/blueprint-gate.mjs` + the `/ship` blueprint check),
writing `app/api/widgets/route.ts` against a blueprint whose Scope is:

```
CASE A  Scope: app/**                                (over-broad)  -> DENY  (hint: TOO BROAD)
CASE B  Scope: app/api/widgets/**                    (specific)    -> ALLOWED
CASE C  Scope: app/api/widgets/** Expires: 2020-01-01 (expired)    -> DENY  (hint: EXPIRED)
CASE D  Scope: app/api/widgets/** Expires: 2999-01-01 (future)     -> ALLOWED
```

Negative test satisfied (over-broad + expired DENY; specific + future-dated ALLOW). Grandfather
check: existing repo blueprints all use specific globs and still cover their routes (suite case
"existing repo blueprints still cover their real routes"); repo `/ship` stays green.

### V2-003 evidence

`tests/harness/hooks.test.mjs` (node:test) pipes synthetic hook-input JSON to every hook and
asserts decisions + fail-open/closed on forced error. Wired as `npm run test:hooks` and a `/ship`
phase-A `hooks` check.

```
# tests 18
# pass 18
# fail 0
```

Mutation negative test (mutate `bash-write-gate.mjs` to always-allow, then revert):

```
=== suite with MUTANT (always-allow) -> RED ===   # pass 16  # fail 2
=== reverted -> GREEN ===                          # pass 18  # fail 0
```

### V2-004 evidence

`superpowers@superpowers` (marketplace `obra/superpowers`, operator-confirmed) added to
`.claude/settings.json` `enabledPlugins`; SessionStart presence check in `session-start.sh`:

```
STATE 1 PRESENT (real settings enables superpowers): [harness] Superpowers plugin: present (verified).
STATE 2 ABSENT  (scratch settings w/o entry):        [harness] WARNING: Superpowers plugin NOT detected this session.
```

CLAUDE.md line 40 now reads "presence verified at SessionStart — a loud warning fires when it's absent".

### V2-005 evidence

Commit `22baea3`. `grep -i "ant design" README.md` → none; rule count reads "Eleven"/"11"; SECURITY.md
§15 note now matches `package.json`'s `test` script (`--experimental-test-module-mocks` IS passed).
Each claim verified against `package.json`, `eslint-rules/index.mjs` (11 rules), ADR-029.

### V2-006 evidence

`docs/session-state.json` formalized as branch-only in-flight state (`.gitignore` + CLAUDE.md
memory-lifecycle line, mirroring `SESSION-HANDOFF.md`/ADR-019). SessionStart skeleton-regen +
reader tolerance verified:

```
absence -> SessionStart writes skeleton -> valid JSON (program="") ; render-handoff functions (no crash)
restore -> rich state back (program="template-maintenance…", categories=22) ; git diff clean
```

Readers (`render-handoff`, `auto-spawn-guard`, `auto-spawn-fire`, `auto-handoff`, `ship.mjs`) already
guard absence (try/catch or existsSync); `auto-spawn-fire`/`auto-handoff` already carried the
"lives only on that branch, never on main" comment. Chosen approach (b) branch-only per operator.

## Phase 0 senior review (post-push, `senior-code-reviewer`)

Ran on the Phase 0 diff. Confirmed both fail-closed guards unchanged, the new hook fail-open,
and `/ship` red-gate wiring correct. Findings:

- **[High] FIXED (commit below):** `bash-write-gate.mjs` lacked the Write-gates' `existsSync`
  "overwrite = continuation" exemption, so it false-denied `sed -i`/`tee`/`cat>` edits to
  EXISTING gated files (`lib/*.ts`, existing routes). Fixed by skipping targets that already
  exist; regression test added (`tests/harness/hooks.test.mjs`, 19/19). Verified: existing
  `lib/api-helpers.ts` + `app/api/health/route.ts` now ALLOW; new uncovered route still DENIES.
- **3 more findings — operator-adjudicated 2026-07-16, all now in `docs/findings-register.md`:**
  1. _(Medium, false-deny)_ redirection regex scans heredoc bodies/quoted text → false-deny on a
     command that merely mentions a gated path (bit a verification command this session).
     **adjudicated → scheduled** (fix early next session; strip heredoc bodies before scanning).
  2. _(Medium, evasion)_ bypassable via shell-variable path or `node -e` one-liner (best-effort
     parser). **adjudicated → scheduled** (add hardening heuristics + gap-documenting negative
     tests in a later phase).
  3. _(Low, maintainability)_ ledger logic duplicated in `build-vs-buy-gate.mjs` vs
     `scope-cover.mjs`. **FIXED `205ddfe`** — refactored build-vs-buy-gate onto scope-cover (one
     shared coverage implementation); suite 19/19 confirms behavior unchanged.

## Phase 1 evidence detail

### V2-101 evidence

**Constitution split + path-lazy rules.** CLAUDE.md was restructured into an ≤8KB always-on
constitution + six path-globbed rule files under `.claude/rules/`, loaded lazily by
`.claude/hooks/rules-injection.mjs` (PreToolUse Edit|Write|MultiEdit — mirrors `skill-activation.mjs`:
advisory `additionalContext` only, fail-open).

Context-tax measured by `scripts/context-tax.mjs` (`npm run context-tax`):

```
                            BEFORE      AFTER
CLAUDE.md (constitution)    25098   →    8184   (7.99KB)  OK vs 8KB
agent-memory surface         3898   →    3898   (head-60; formalized to a digest by V2-102)
handoff auto-status          7872   →    7872
TOTAL always-on             36868   →   19954   (19.49KB)  OK vs 20KB
```

Both budgets pass. Negative test (`tests/harness/hooks.test.mjs`, suite now 26/26): a fixture
CLAUDE.md of 9000B makes `context-tax --strict` exit 1; the real repo passes. Live hook evidence:
writing `scripts/context-tax.mjs` and `tests/harness/hooks.test.mjs` this session triggered
`rules-injection` to inject `deploy.md`/`harness.md` (captured in the session transcript). Suite
cases prove injection on prisma/api/component paths, NO injection on a non-matching path
(`README.md`), and non-edit tools ignored.

**Zero rule-content-loss mapping** (old `CLAUDE.md` line-range → new home). Every rule/fact has
exactly one home; the constitution keeps the always-on floor, domain detail moved. Automated
sweep confirms all 11 ESLint rule names + key Hard-rule/trap keywords (SCRUB_FIELDS,
prismaUnfiltered, withInternalAuth/withApiAuth, EXCLUDE, executeRawUnsafe, next@16.2.9,
context-watchdog, dockerAck, SMTP_HOST, unsafe-inline, localePrefixRegex, generated/prisma,
audit-purge, tierAck, complexityAck, ai-eval, Superpowers, EnterPlanMode, "market scan") still
present across `CLAUDE.md` + `.claude/rules/`.

| Old CLAUDE.md lines | Section                                                                                                                     | New home                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1–5                 | Identity, stack, fork lifecycle                                                                                             | `CLAUDE.md` (intro)                                                                                     |
| 7–16                | Read before non-trivial work                                                                                                | `CLAUDE.md` (Read-before line) + rule-file index blockquote                                             |
| 18–24               | Token thrift                                                                                                                | `.claude/rules/harness.md` (Token thrift)                                                               |
| 26–28               | Harness (`.claude/`) — agents, allowlist, read-denials                                                                      | `.claude/rules/harness.md` (The `.claude/` harness)                                                     |
| 30–36, 39–42        | Standing instructions (main SoT, pushed-or-didn't, /ship, review rail, market benchmark, Superpowers, blueprint, auto-plan) | `CLAUDE.md` (Standing instructions); CI-dormancy + portability + memory-lifecycle detail → `harness.md` |
| 37–38               | Deploy/ops standing rules (offer `/deploy`, live-URL-by-running)                                                            | `.claude/rules/deploy.md` (Standing instructions) + 1-line pointer in `CLAUDE.md`                       |
| 44–53               | Five Pillars + `/ship` enforcement                                                                                          | `CLAUDE.md` (Five Pillars); wave-off mechanism kept in Hard rules                                       |
| 55                  | Conditional 6th pillar — AI-Quality                                                                                         | `.claude/rules/ai.md` + 1-line flag in `CLAUDE.md`                                                      |
| 57–59, 63–65, 71    | Hard rules — pillars-gate, quartet, push, `.env`, secret-logging, zod/session                                               | `CLAUDE.md` (Hard rules, terse floor); quartet full mechanism → `harness.md`                            |
| 60–62               | Quartet detail (build-vs-buy / blueprint / complexity / ai-eval)                                                            | `.claude/rules/harness.md` (The enforcement quartet)                                                    |
| 66, 67, 70, 72      | Restricted-column/SCRUB, go-through-Prisma, audit-fragile, naming                                                           | `.claude/rules/prisma.md` (constitution keeps the 1-line Prisma floor)                                  |
| 68                  | UI→API→service→Prisma (`no-prisma-in-client`)                                                                               | `CLAUDE.md` (Hard rules)                                                                                |
| 69                  | Auth wrapper table                                                                                                          | `.claude/rules/api-routes.md` (constitution keeps the 1-line floor)                                     |
| 73                  | Eleven ESLint rules roster                                                                                                  | `.claude/rules/harness.md` (Local ESLint plugin); `CLAUDE.md` keeps "eleven rules at error" + pointer   |
| 75–77               | UI Definition of Done                                                                                                       | `.claude/rules/design.md` + 1-line in `CLAUDE.md`                                                       |
| 79–81               | Project tiers                                                                                                               | `.claude/rules/harness.md` (full contract) + summary in `CLAUDE.md`                                     |
| 83–89               | Ask before                                                                                                                  | `CLAUDE.md` (Ask before — verbatim, always-on)                                                          |
| 91–96               | Commands                                                                                                                    | `.claude/rules/harness.md` (Commands)                                                                   |
| 98–100              | Growth path                                                                                                                 | `.claude/rules/deploy.md` (Growth path)                                                                 |
| 104, 115            | Traps: context-watchdog wiring, stale `.next`                                                                               | `.claude/rules/harness.md` (Known traps)                                                                |
| 105, 106, 111       | Traps: generated/prisma path, Auth.js JWT sessions, vercel.json migrate cadence                                             | `.claude/rules/prisma.md` (Known traps)                                                                 |
| 107, 110, 114       | Traps: locales config-driven, CSP unsafe-inline, root not-found.tsx                                                         | `.claude/rules/design.md` (Known traps)                                                                 |
| 108, 109, 112, 113  | Traps: rate limiter in-memory, sendEmail no-throw, uploads/PDF, Docker artifact                                             | `.claude/rules/deploy.md` (Known traps)                                                                 |
| 117                 | When in doubt, stop and ask                                                                                                 | `CLAUDE.md` (last line)                                                                                 |

### V2-101 senior review (post-push, `senior-code-reviewer`)

Ran on the V2-101 diff. Confirmed the hook is fail-open/non-blocking and the context-tax mechanism
sound. Four findings, **all fixed in the follow-up commit**:

- **[High] zero-loss claim was false** — ADR-020 (senior-review CI path + `install-senior-review.mjs`
  portability) and ADR-048 (React Compiler build note) were dropped; the keyword sweep was
  hand-picked. FIXED: restored both to `.claude/rules/harness.md`; added a **mechanical `ADR-\d+`
  set-diff test** (old `CLAUDE.md` vs new `CLAUDE.md` + rules) so a future dropped ADR reds the suite.
- **[High] rules-injection glob under-match** — `lib/api-helpers.ts`, `lib/rate-limit.ts`,
  `lib/auth.ts`, `middleware.ts`, `lib/email.ts`, `lib/export.ts` (named in the rule files' own
  Ask-before/traps) matched no glob. FIXED: added them to `api-routes.md`/`deploy.md` globs;
  per-file + per-rule-file frontmatter regression tests added (suite 26→29 green).
- **[Medium] scripts/** overlap** — `deploy.md` + `harness.md` both globbed `scripts/**`,
  double-injecting on every script edit. FIXED: narrowed `deploy.md` to the four deploy scripts.
- **[Low] harness self-doc drift** — FIXED: `rules-injection` row + count 13→14 in
  `docs/harness-inventory.md`; `rules/*.md` section in `.claude/README.md`.

All four logged in `docs/findings-register.md` (2026-07-16), status `fixed`.

### V2-102 evidence

**Memory retrieval-on-demand.** `docs/agent-memory.md` restructured into a `<!-- BEGIN/END:digest -->`
block (section headers + one-liners, surfaced at SessionStart) + full `##` sections retrieved on
demand. The 120-line "Gotchas & landmines" section was split into six themed `## Gotchas — …`
sections so every section is ≤60 lines; **zero entry loss** (all dated entries preserved verbatim,
just re-homed under themed headers). `session-start.sh` now surfaces ONLY the digest block (was
whole-file / head-60).

`scripts/memory-digest.mjs` (`npm run memory-digest`) refreshes the digest `(N)` entry-counts and
enforces the mechanical budget — digest ≤30 lines, each section ≤60. Real-file check:

```
[memory-digest] digest 10/30 lines · 9 content sections · Durable decisions:43L · … · Operator directive:16L
[memory-digest] all budgets OK.
```

Context-tax win (`scripts/context-tax.mjs`, which now measures the digest block not head-60):

```
agent-memory surface : 3898 → 2763 bytes ;  TOTAL always-on 19954 → 19288 bytes (18.84KB) OK vs 20KB
```

Negative test + lookup (`tests/harness/hooks.test.mjs`, suite 29→32 green): a fixture with a
71-line section makes `memory-digest --strict` exit 1 (cites the 60-line budget); a full gotcha
(`gitleaks is NOT preinstalled`) is retrievable from its `## Gotchas — deploy, env & CI` section
below the digest, proving on-demand retrieval. `/remember` SKILL.md updated to append to a themed
section + regenerate the digest.

### V2-102 senior review (post-push, `senior-code-reviewer`)

Ran on the V2-102 diff (+ the context-watchdog removal). **Verified zero entry loss** (all 31 dated
entries preserved verbatim, digest counts matching live sections); watchdog removal confirmed clean
(no dangling functional references). Five findings, **all fixed in the follow-up commit**:

- **[High] `boldOf` prefix-match collision** in `memory-digest.mjs` — prefix matching could silently
  corrupt two sections' digest counts with no warning. FIXED: exact bold↔section-name matching +
  duplicate-match flag.
- **[Medium] digest count could drift undetected** — only `--write` refreshed counts; check-mode
  never validated. FIXED: check-mode/`--strict` now reds when a `(N)` mismatches the live
  `entryCount` (demonstrated).
- **[Low ×3]** newest-at-top order broken in 2 themed sections (re-sorted); `/remember` SKILL example
  - promotion-tree still named the old `## Gotchas & landmines` (updated to themed sections);
    `docs/harness-inventory.md` hook count inconsistent → corrected to 15 + added the `bash-write-gate`
    and `routing-receipt` rows.

All five logged in `docs/findings-register.md` (2026-07-16), status `fixed`. Hook suite stays 32 green.

### V2-103 evidence

**Velocity becomes a gated pillar** (ASK-confirmed wording: rename Pillar 1 → **"Speed & Velocity"**).
Renamed + expanded in the constitution (`CLAUDE.md`, kept ≤8KB: 8190B) and the full definition in
`docs/uat-rubric.md` (runtime speed AND dev velocity — context tax, warm `/ship`, parallel-by-default).
Baselines recorded in `project.config.json` `velocityBaselines` (`shipWarmSeconds`, `hookChainMs`);
all three checks are advisory/fail-open (house pattern) and add <100ms to any path.

Three checks, each demonstrated firing on a synthetic regression:

- **(a) context-size** — `scripts/context-tax.mjs` warns when the always-on SessionStart bytes exceed
  budget; wired into `session-start.sh` (WARN on OVER) and enforced as a `/ship` phase-A hook test
  (the V2-101 "context-tax --strict FAILS on over-budget fixture" case IS this check).
- **(b) `/ship` wall-time** — `scripts/ship.mjs` warns when the total exceeds 125% of
  `shipWarmSeconds`. Captured on a GREEN ship with a synthetic 1s baseline:

  ```
  note [velocity]: /ship took 88s > 125% of the 1s warm baseline (1s). …
  ship: green -- … all pass (88s total)
  ```

- **(c) hook-latency** — `scripts/hook-latency.mjs` (`npm run hook-latency`) times the
  `UserPromptSubmit`+`PreToolUse` chain (measured ~591ms/9 hooks; recorded baseline) and warns past
  150%. Hook suite (34 green): `--strict` with `HOOK_CHAIN_BASELINE_MS=1` exits 1; a generous
  baseline passes.

**skill-activation double-run** (backlog "de-dup if material"): measured — it runs twice per turn
(~94ms + ~72ms). NOT deduped: the two fires serve **distinct** events — `UserPromptSubmit` matches
prompt _keywords_ (intent) and `PreToolUse` matches the touched _file path_; removing either drops a
real signal. Documented as intentional, not redundant.

### V2-103 senior review (post-push, `senior-code-reviewer`)

Confirmed the two wired-into-critical-paths pieces are correctly **fail-open** (the `ship.mjs`
wall-time warn cannot red a green ship; the `session-start.sh` context block never blocks session
start) and the constitution ≤8KB invariant holds. Three findings, **all fixed**:

- **[High] `hook-latency.mjs` measured a fictional chain** — it summed mutually-exclusive PreToolUse
  matcher groups (Edit+Bash+Read, 9 hooks that never co-fire) and fed Edit-shaped input to the
  Bash-matcher hooks (which early-exit). FIXED: rewrote to measure **per-turn** chains separately
  (edit-turn vs bash-turn, each with tool-shape-correct input) and baseline the **worst** turn;
  re-recorded `hookChainMs` 591 → 374 (edit-turn 374ms, bash-turn 322ms — real numbers).
- **[Medium] unchecked `spawnSync`** — a failed hook silently recorded ~0ms. FIXED: checks
  `res.error`/`res.status`, prints an unreliable-measurement WARN, `--strict` exits 1 on it.
- **[Low] `hardest-gated` not preserved** in the rubric after the constitution trim. FIXED: added
  to the rubric's Secure pillar.

All three logged in `docs/findings-register.md` (2026-07-16), status `fixed`. Hook suite stays 34 green.

### V2-104 evidence (+ the V2-106 / V2-107 parallel demonstration)

**V2-104 — parallel-by-default.** Binding line in the constitution (`CLAUDE.md`, held ≤8KB: 8185B):
"Dispatch ≥2 write-disjoint units of multi-part work as parallel subagents in ONE message,
unprompted (file-ownership sets mandatory)." Full mechanism in `.claude/rules/harness.md` §Parallel-
by-default: file-ownership sets, ADR-022 tiering, the two calibration notes (dependency chains
don't parallelize; orchestrator-only during waves), and one-`/ship`-per-wave.

**Demonstrated once, in this program:** V2-106 and V2-107 were dispatched as a **parallel subagent
pair in a single message**, each with an explicit disjoint file-ownership set. Provenance (the
evidence the receipts would carry) is in git — the two agents' diffs are strictly non-overlapping:

- **V2-107** wrote **only** `.claude/settings.json` (1 line).
- **V2-106** wrote **only** `package.json` + `docs/build-vs-buy-ledger.md` + `docs/decisions/ADR-054-*.md`.

No file was touched by both; the orchestrator held off editing their files during the wave, then
integrated with a single `/ship`. _Note:_ the intended receipt sink `.claude/state/routing-receipts.jsonl`
(the `PostToolUse(Task)` hook) did **not** populate in this web session — async subagent dispatch
here doesn't fire that hook — so the git-diff disjointness above stands in as the demonstration
evidence. (Flagged, not hidden: the receipt mechanism exists and is wired; it just isn't triggered
by this environment's background-Agent path.)

**V2-106 — ccusage (LEDGER).** `npm run tokens` → `npx -y ccusage@latest session` (no runtime dep;
reads local `~/.claude/projects/**/*.jsonl`). Verified: produced a real per-session/model spend
report (~136.5M tokens / **$112.53** across opus-4-8 + sonnet-5). `docs/build-vs-buy-ledger.md` entry
(ccusage vs. build-a-log-analyzer vs. token-policy prose); ADR-054 amended — `npm run tokens` is the
"budget line" instrument; the observe-only `routing-report` promotes to a soft `/ship` gate once the
operator sets a budget.

**V2-107 — permission friction.** `.claude/settings.json` deny-list: removed only `Bash(git branch
-d *)` so the **safe** delete (git refuses on an unmerged branch) falls through to the existing
`Bash(git branch*)` allow. `commit --amend` on an unpushed HEAD is **not matcher-expressible**
(static string/glob can't read git state), so it stays denied. Force-push (`--force`/`-f`/
`--force-with-lease`), `reset --hard`, `clean`, `rebase -i`, `commit --amend`, `checkout`/`restore`
guards all still denied.

⚠️ **Senior-review High (fixed):** the lexical deny only covered `git branch -D`, so `git branch -d
-f` / `-d --force` / `--delete --force` (force-delete via flag combo) initially fell through to the
allow — a real regression, reproduced live. **Fixed** by a **semantic** guard in
`.claude/hooks/dangerous-commands.mjs` (fail-closed): it denies `git branch` force-delete in ANY
flag spelling/order (`-D`, `-d -f`, `-Df`, `-fd`, `--delete --force`, …) and allows the bare safe
`-d`/`--delete`. Regression test in `tests/harness/hooks.test.mjs`. Also: `.claude/settings.json`'s
`permissions` arrays added to the Ask-before surface (the widening was previously ungated).

<a id="v2-105-evidence"></a>

### V2-105 evidence — native agent-teams evaluation → ADR-057 → `/fan-out`

**Research (two-angle, cross-checked with in-session behavior).** Native capability survey +
repo inventory (`.claude/hooks/routing-receipt.mjs`, `scripts/routing-report.mjs`,
`.claude/skills/batch`, four `.claude/agents/*.md`). Directly-observed native behavior this
session, not assumed: (a) two subagents dispatched in ONE message ran **concurrently** and both
returned — native in-message dispatch is real; (b) the earlier V2-106/107 wave did **not**
populate `routing-receipts.jsonl` — async dispatch doesn't fire `PostToolUse(Task)` here. Native's
one genuine gap: file-ownership is **advisory, not enforced**.

**ADR-057 written** (`docs/decisions/ADR-057-parallel-execution-mechanism.md`, MADR: drivers +
per-option Good/Bad). The analysis **recommended Option 1 (native, no skill)** on ADR-034
(don't-over-engineer) grounds.

**ASK verdict = custom (operator override).** The operator chose **Option 2 — build `/fan-out`** —
prioritizing enforced file-ownership now over deferring it behind a future incident. Recommendation
preserved in the ADR as the honest record; decision is the operator's. Status → Accepted.

**Built `/fan-out`** (the KICKOFF "build only if custom" gate satisfied):

- `.claude/skills/fan-out/SKILL.md` — decompose → declare disjoint ownership sets → **refuse on
  overlap** → dispatch native parallel subagents in one message → **verify scope** → one `/ship`.
  Has a Skip-when (one unit / shared files / dependency chain / `/batch` territory / Agent-Teams).
- `scripts/fan-out.mjs` (`npm run fan-out`) — **enforcement native lacks**, pure git/path arithmetic,
  reuses `scope-cover.mjs`'s `globToRe`. `check-overlap <manifest>` exits 1 naming colliding globs;
  `verify-scope <manifest>` exits 1 listing any changed file matching 0 sets (out-of-scope write) or
  ≥2 sets (sets not disjoint). Uses native dispatch — does not replace it.
- Registered: `skill-rules.json` advisory rule; `docs/blueprints/.fan-out.json` scratch manifest
  gitignored; `harness.md` §Parallel-by-default points to it.
- **5 hook tests** in `tests/harness/hooks.test.mjs` (globsOverlap nested/identical/sibling;
  findDeclaredOverlaps; unitsMatching attribution; loadManifest validation; check-overlap CLI exit
  codes) — green. Live-verified: disjoint manifest passes, `lib/foo/**` ∩ `lib/**` refuses, an
  out-of-scope working-tree file is flagged by verify-scope.

⚠️ **Senior-review (post-push, fixed) — found 1 High + 3 Medium + 1 Low, all addressed (42 tests green):**

- **High — `globsOverlap` was false-disjoint for mid-segment wildcards** (the dangerous direction:
  `check-overlap` would PASS a colliding manifest). The representative-path heuristic (wildcards →
  literal `x`) missed e.g. `lib/validations/order*.ts` ∩ `lib/validations/*.test.ts` (collide on
  `order.test.ts`). **Fixed:** replaced with a **sound** segment-by-segment glob-intersection
  (`segmentsIntersect` product-automaton over `*`/`?`/literals + `**` segment absorption). All 4
  reviewer counterexamples now detected; regression test added.
- **Medium — `git status` collapsed brand-new dirs** → `-uall` added (per-file granularity).
- **Medium — clean-tree precondition was doc-only** → `check-overlap` now snapshots the pre-wave dirty
  set to a `.baseline`; `verify-scope` subtracts it (enforced in code; temp-git integration test).
- **Medium — ADR/SKILL overclaimed per-unit attribution** → narrowed to the true **aggregate-disjoint**
  property (one shared tree → no per-subagent diff); per-unit isolation moved to a migration trigger.
- **Low — bare "OK" on zero changed files** → verify-scope now names any unit that changed nothing.

_Follow-up logged (findings-register):_ `routing-receipt.mjs` under-records async dispatch in this
env — a separate small fix; `/fan-out`'s own diff-verification does not depend on it.

<a id="v2-2xx-evidence"></a>

### Phase 2 evidence — "Complete the loop" (V2-201 … V2-210)

**The loop machinery (V2-201/204/208 — built as a parallel `/fan-out` wave; V2-206; V2-202/203/205/209; V2-207).**

- **V2-201 `/benchmark`** — skill + `docs/benchmarks/it-asset-management.md`: Snipe-IT (OSS) mined
  from its real asset model (asset tag/model→category/status labels/checkout/depreciation), cross-checked
  vs GLPI/ServiceNow/Asset Panda → 12 table-stakes + 9 differentiators + 5 anti-features, every row sourced.
- **V2-204 `/explore`** — skill; the pilot run produced ADR-059 (scaffold vs hand-build vs extend) with a
  pillars-aligned trade-off table + the losing options recorded, feeding the blueprint's Architecture sketch.
- **V2-208 `/retro`** — skill; the broke/learned/missing → agent-memory + omission→`docs/benchmarks/` feedback
  path. These three were built as **Wave 1**, a real parallel subagent wave (three write-disjoint skill dirs):
  `/fan-out check-overlap` passed, the three agents ran concurrently, `/fan-out verify-scope` confirmed every
  changed file landed in exactly one declared set — the live V2-104/V2-105/V2-205 parallel-execution evidence.
- **V2-206 two-stage review** — `senior-code-reviewer` + `/code-review` now run **Stage 1 spec-compliance**
  (map each changed file to a covering blueprint `Scope:`; report out-of-scope + story-contradicting behavior)
  **before Stage 2** quality lenses. The pilot's post-push review ran both stages against `asset-tracker.md`.
- **V2-202/203/205/209 blueprint template** — Feature-parity, Universal app-floor, Work-graph DAG, and
  Amendment-delta sections; `/ship`'s `blueprint-content` gate (`scripts/lib/blueprint-content.mjs`,
  unit-tested) warns (shared: blocks) on a benchmark-referencing blueprint with no parity section, or a real
  amendment row with an empty `Confirmed:`.
- **V2-207 BDD traceability** — ADR-058 **Accepted** (operator signed off on the playwright-bdd
  runtime, 2026-07-17) + build-vs-buy ledger. Two halves: (1) the owned, dependency-free
  `scripts/bdd-coverage.mjs` COVERAGE gate — a story with no scenario, a scenario with no `@US`
  tag/no steps, a dangling `@US`, or a step with no definition reds (unit-tested incl. the "delete a
  step definition → red" acceptance); (2) the playwright-bdd EXECUTOR now installed +
  wired (`playwright-bdd.config.ts`, `npm run bdd:gen`/`test:bdd`), verified: `bddgen` generates a
  Playwright spec from the pilot's `.feature` + `.ts` steps. Coverage enforced under `/ship --full`
  (V2-401); scenario execution needs a live app+DB (deferred with `--full`). Warm `/ship` untouched.

**V2-210 pilot — the Asset Tracker ran the WHOLE loop, each station evidenced:**

| Station          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /benchmark       | `docs/benchmarks/it-asset-management.md` (12 table-stakes, sourced)                                                                                                                                                                                                                                                                                                                                                                   |
| /explore         | ADR-059 — 3 approaches, pillars trade-off, losers recorded                                                                                                                                                                                                                                                                                                                                                                            |
| /blueprint       | `docs/blueprints/asset-tracker.md` — parity (12 ITAM rows dispositioned IN/DEFERRED/N/A), app-floor, DAG, US1-US4 + worst-path scenarios, `BDD:` marker, `Scope:` covering the routes                                                                                                                                                                                                                                                 |
| implement        | `/scaffold-entity Asset` (model+zod+routes+pages+recycling bin) + offline migration (`assetTag` made `@unique`) + the bespoke **US4 status-transition invariant** (`isLegalStatusTransition` guard on PUT; `assetTag` immutable on update)                                                                                                                                                                                            |
| BDD verify       | `tests/features/asset-tracker.feature` (@US1-@US4) + steps; `npm run bdd-coverage` → OK (4/4 required stories covered); **deleting a step def reds it** (verified live)                                                                                                                                                                                                                                                               |
| contract test    | `tests/contracts/asset-transition.test.ts` — the lifecycle invariant incl. the US4-worst RETIRED→ASSIGNED reject                                                                                                                                                                                                                                                                                                                      |
| two-stage review | `senior-code-reviewer` on 452ba18: Stage 1 confirmed Scope-clean + traced US1-US4 (caught the AC-4.1 422-vs-400 drift as a Stage-1 finding); Stage 2 found 1 High + 2 Medium + 1 Low in the hand-layered code (assignee picker → wrong `/api/user` path, duplicate-tag 500 not 409, dead status/category filters, AC status-code drift) — ALL fixed, re-shipped green (85s). The V2-206 protocol proving its worth on a real feature. |
| /ship            | green (88s) — build + coverage + the new contract test all pass                                                                                                                                                                                                                                                                                                                                                                       |
| /retro           | this section + the Phase-2 retro below; parity DEFERRALs (T2/T9/T11) logged in findings-register                                                                                                                                                                                                                                                                                                                                      |

The feature is **mergeable and green**; the machinery it exercised is the phase's deliverable, the pilot is its proof.

<a id="v2-301-evidence"></a>

### Phase 3 evidence — V2-301 visual iteration loop

**Environment unblock (the enabler):** this web container has native Postgres 16 (no Docker) — brought
up a cluster, migrated (incl. the Asset table + pgvector), seeded, ran `npm run dev`, and drove real
Playwright captures. Full recipe recorded in `docs/agent-memory.md` (browser QA & egress, 2026-07-17);
login needs `pressSequentially` (react-hook-form ignores `fill()`).

**The loop, run for real (capture → view → critique → fix → re-capture):**

- **Harness** — `scripts/capture-screens.mjs` (`npm run capture -- --feature <f> --routes <p1,p2>`):
  logs in, screenshots each route × {desktop, mobile} × {light, dark} × enabled locales →
  `docs/verification/<feature>/`. Prints "NOW VIEW these images" — captures are evidence, not a claim.
- **Rule landed** — `.claude/rules/design.md` §Visual iteration loop (binding: affirming a screen
  without attached captures is invalid); `/design-qa` gained a during-build mode.
- **Worked example** — Asset Tracker. Viewing the `before/` captures, the critique caught a real
  **copy defect**: the Status/Category controls surfaced raw enum tokens (`IN_STOCK`, `LAPTOP`) in the
  form selects and list badges. Fixed via `components/asset/asset-labels.ts` (humanized "In stock" /
  "Laptop", applied in `AssetColumns` + `AssetForm`; DB/API keep the enum values). `after/` captures
  confirm the fix (list badges "Assigned/In stock/In repair/Retired", "Laptop/Monitor/Phone", light +
  dark; form selects "In stock"/"Laptop"). Before/after set + critique in
  `docs/verification/asset-tracker/` (`NOTES.md`). Residual polish logged in `findings-register`.

<a id="v2-304-evidence"></a>

### Phase 3 evidence — V2-304 spacing/typography lint

**The gate.** A twelfth local ESLint rule, `no-arbitrary-className` (`eslint-rules/rules/`), is the
layout sibling of `no-raw-hex-color`: color comes from tokens, and now so do spacing + type. It
flags an arbitrary Tailwind value **only** on the utilities the design scale governs — spacing
(`p/px/py/…`, `m/…`, `gap/gap-x/gap-y`, `space-x/space-y`) and font-size (`text-[…px|rem|em]`) —
and deliberately leaves every other arbitrary value alone (`grid-cols-[1fr_auto]`,
`w-[calc(…)]`, `min-h-[44px]` touch targets, `top-[3px]`, `data-[state=open]:` variants, arbitrary
colors). Wired at `error` scoped to `**/*.{jsx,tsx}` in `eslint.config.mjs`; escape hatch is the
single-line `// eslint-disable-next-line rihal-template/no-arbitrary-className`.

**Build-vs-buy (ledger).** Evaluated `eslint-plugin-tailwindcss` — its `no-arbitrary-value` bans
ALL `[...]` values bluntly and would false-positive on the ~50 legit arbitrary values off the
spacing/type axes, with no way to scope it. Chose to **build the scoped local rule** (zero runtime
dep); the plugin was **uninstalled after evaluation** — no dependency added (knip enforces it).
Full adjudication in `docs/build-vs-buy-ledger.md`.

**Measured + resolved.** A full scan found exactly 3 pre-existing hits (0 arbitrary spacing, 3 raw
font-size). Resolution:

- `OrgSwitcher.tsx` monogram `text-[15px]` → `text-base` (14px) — pulled **onto the type scale**.
- `BrandedStatus.tsx` hero code `text-[56px]` — **escape-hatched** (outsize display numeral; no
  token exists above `text-h1`/38px).
- `NotificationsMenu.tsx` count badge `text-[10px]` — **escape-hatched** (10px keeps a 2-digit
  count inside a 16px dot; `text-xs`/12px would clip).

**Tested + verified.** RuleTester coverage in `tests/eslint-rules/rules.test.mjs` (16 valid / 9
invalid: spacing, font-size, `length:` hint, multi-hit-reports-all, template-literal chunks flagged;
grid/calc/min-h/positioning/variant/arbitrary-color and px/rem/em-as-substring-of-a-var/theme/named
value allowed — the senior-review false-positive class) — `npm run test:lint-rules` → 12/12 green. Visual loop run on the altered surface:
`/style-guide` (which exercises all three components) captured desktop+mobile × light+dark; the
monogram swap is imperceptible and on-scale, the two escape-hatched values unchanged, BrandedStatus
404/403 hero numerals render correctly. Captures + critique in `docs/verification/v2-304-lint/`.

<a id="v2-305-evidence"></a>

### Phase 3 evidence — V2-305 copy chokepoint + copy lint

Two halves make copy a gated chokepoint instead of a per-string judgement call.

**Half 1 — the chokepoint (`no-literal-jsx-text`, the 13th ESLint rule).** Every user-facing
string must go THROUGH next-intl, so `messages/*.json` is the single place copy lives. The rule
flags literal JSXText with a translatable word (`<button>Save</button>`) and a bare string in a
curated user-facing attribute (`placeholder`/`title`/`alt`). Deliberately exempt: pure whitespace/
digits/symbols, `code`/`pre`/`kbd` children, `aria-*`/`data-*`/structural attributes, and — at the
config layer — dev/reference pages (style-guide), the **context-free root boundaries**
(`app/not-found.tsx`, `app/global-error.tsx` — they prerender outside `[locale]` with no next-intl
provider per the design.md Next-16 trap, so they MUST ship literal fallback copy), and tests. Wired
at `error` on `**/*.{jsx,tsx}`. It also catches literals reached through a `JSXExpressionContainer`
— ternaries (`{cond ? "Active" : "Inactive"}`), braced strings (`{"Hi"}`), template literals,
`placeholder={"x"}` — walking up only TRANSPARENT wrappers (ternary/logical/`+`) so a string inside a
`t("…")` call stays correctly unflagged (the V2-305 senior-review bypass fix). **Product code lands
at 0 violations** — the app was already fully next-intl'd; the only literals found were exactly the
exempt categories (context-free root boundaries + tests), confirming the rule's scope. RuleTester:
16 valid / 10 invalid (direct text + placeholder/title/alt + the expression-container bypass class
fail; translated `t()` expressions / symbols / code / aria / data / non-user-facing-attr literals pass).

**Half 2 — the copy-lint gate (`scripts/copy-check.mjs`, `/ship` phase-A `copy`).** Holds the
source-locale copy to a deterministic house style: (1) no trailing period on a short label (ellipsis
`...`/`…` and `?`/`!` allowed); (2) sentence case, not Title Case (only word-1 + allowlisted proper
nouns / ALL-CAPS acronyms capitalized); (3) a configurable banned→preferred terminology map. Runs on
the Latin-script default locale (title-case is meaningless for Arabic). Config/waivers in
`project.config.json` `copy`. **Migrated 22 Title-case labels** in `messages/en.json` to sentence
case ("Back Home"→"Back home", "Audit Log"→"Audit log", "Create User"→"Create user", "Change
Password"→"Change password", …); "Entity ID" correctly kept (acronym); no test or app-code hardcoded
the old strings (all via `t()`). Negative-test: a planted `"Submit Request."` fails on BOTH
trailing-period and Title Case, and reverts clean; unit tests in `tests/harness/copy-check.test.mjs`
(6/6) prove deny/allow for every rule + waiver + flatten.

**Build-vs-buy.** Both halves are BUILD (no dependency): `no-literal-jsx-text` over
`eslint-plugin-i18next` (its `no-literal-string` allowlist is inverted vs the house opt-in set;
knip forbids a dead dep — the V2-304 lesson); the copy checker over Vale/alex (heavier prose
linters). Ledger: `docs/build-vs-buy-ledger.md`.

<a id="v2-306-evidence"></a>

### Phase 3 evidence — V2-306 OSS catalog + `/adopt` skill

Makes reuse the DEFAULT by giving the build-vs-buy scan a step-0 catalog and a skill that runs it.

- **`docs/oss-catalog.md` (committed).** Two tables: (1) the **feature-oracle products** per category
  (Plane / Twenty / Documenso / Formbricks / Cal.com / Snipe-IT / GLPI — with repo + license + what
  to mine), so `/benchmark`/`/blueprint` mine a real data model, not a marketing page; (2) the
  **capability adopt-or-build table** (uploads, jobs, realtime, flags, search, PDF, rich-text,
  analytics, …) with the in-stack default, the self-host OSS option + license, the SaaS option, and a
  verdict/pointer. Header states the reading rules (in-stack / self-host / SaaS; AGPL + >50 KB flags)
  and the feedback loop: a catalog MISS means add the row you wished existed.
- **`/adopt` skill (`.claude/skills/adopt/SKILL.md`).** The ADR-032 scan run as a skill: name the
  capability → look it up in the catalog (step 0) → surface the in-stack / self-host-OSS / SaaS /
  build-thin trade-off with `AskUserQuestion` (license, weight, data-egress, self-host) → on the
  operator's choice write the `build-vs-buy-ledger.md` entry (+ ADR stub for a runtime dep, +
  Ask-before for >50 KB / AGPL-fork) → install per recipe → `/ship` green. Skip-when the capability
  is already in-stack.
- **Gate messages updated (step 0).** BOTH build-vs-buy deny paths now name the catalog first:
  `.claude/hooks/build-vs-buy-gate.mjs` (Write) gained a `(0) check docs/oss-catalog.md … or run
/adopt` step ahead of the REPO-MAP/scale-up/web-search steps; `.claude/hooks/bash-write-gate.mjs`
  (the Bash-write path) mirrors it. Behavior unchanged — the message is the only edit.
- **Demonstrated on a real capability.** Ran `/adopt "rich-text editor"` — a genuine gap (no in-stack
  editor). Catalog hit → Tiptap (MIT) vs Lexical vs build-on-ProseMirror vs plain textarea → decision
  **adopt Tiptap when needed**, recorded as **ADR-060** + a `build-vs-buy-ledger.md` entry
  (`Scope: lib/editor/**`, deferred — the "entry ahead of build" pattern, cf. pg-boss). No wasteful
  install; the artifacts the skill produces (ledger entry + ADR stub with the license/weight/self-host
  call made) are the demonstration.

<a id="v2-309-evidence"></a>

### Phase 3 evidence — V2-309 build-vs-buy completeness

Closes the two gaps that let a build-vs-buy decision be skipped or rubber-stamped.

- **Surface widened (`isGatedCapabilityFile`, `.claude/hooks/lib/scope-cover.mjs`).** The gate fired
  only on new `lib/**` files; a new **reusable UI primitive** (`components/shared/**`) or a new
  **harness tool** (`scripts/**`) is just as much a build-vs-buy call, and both slipped through.
  Extended to all three surfaces with the same exclusion logic (never gate tests / `.d.ts` / the
  hand-written `lib/validations` + `lib/prisma` seams), and widened the extension set to `.mjs` so
  scripts are covered.
- **`Considered:` now required (`ledgerCoverInfo`).** Coverage was a bare `Scope:`-glob match — an
  entry could "cover" a file while naming zero alternatives, which is a rubber stamp, not a scan. The
  ledger is now split into entry BLOCKS on the `Scope:` boundary, and a matching block counts as
  coverage ONLY if it carries a `Considered:` line. `ledgerCoverInfo` returns
  `sawScopeWithoutConsidered` so the gate distinguishes "Scope matched but no alternatives named"
  (a targeted "add a Considered: line" message) from "no entry at all".
- **Both gate paths + messages.** `build-vs-buy-gate.mjs` (Write) and `bash-write-gate.mjs` (the Bash
  path — dropping to a heredoc doesn't bypass it) both use the shared logic; deny reasons now name the
  widened surface and the `Considered:` requirement, and point at `docs/oss-catalog.md` as step 0.
- **Negative tests (`tests/harness/hooks.test.mjs`, `npm run test:hooks` → 54/54).** A new V2-309 case
  proves, against fixture ledgers: (a) a new `components/shared/*.tsx` and a new `scripts/*.mjs` are
  DENIED with no covering entry; (b) a covering entry WITH a `Considered:` line ALLOWS; (c) a covering
  `Scope:` with NO `Considered:` line is DENIED and the reason names `Considered`; (d) a `.test.mjs`
  on the new surface is excluded (ALLOW). The existing `lib/`-deny / `lib/validations`-allow
  regression case still passes unchanged.

<a id="v2-308-evidence"></a>

### Phase 3 evidence — V2-308 visual regression

Turns the V2-301 capture set into a regression net: a signed-off look becomes a committed baseline,
and a later change that shifts pixels produces a red diff instead of slipping past the eyeball pass.

- **Build-vs-buy (ledger).** Considered **Lost Pixel** (OSS, but owns its own capture step +
  config, duplicating `scripts/capture-screens.mjs`; CI/SaaS-leaning), **Argos CE** (SaaS-first —
  uploads to argos-ci.com, needs egress/account, wrong for a local loop), **Playwright
  `toHaveScreenshot`** (zero dep but re-captures in the test runner + opaque per-test baselines),
  and chose to **BUILD a thin differ on `pixelmatch` + `pngjs`** (both small, MIT, dependency-free
  pure-JS — what Lost Pixel/Playwright use internally) that reuses the capture harness this repo
  already owns. `pixelmatch`/`pngjs` are dev-dependencies (no runtime bundle cost). Full adjudication
  in `docs/build-vs-buy-ledger.md`.
- **The differ (`scripts/visual-regression.mjs`).** A pure `compareImages(baseline, current, {threshold,
maxDiffRatio})` (a dimension change or a diff beyond the tolerance = a regression; writes a
  `*.diff.png`) + a CLI that diffs a committed `baseline/` dir against a fresh capture dir and exits
  non-zero on any regression. Wired as `npm run visual-regression`, invoked at **QA time
  (`/design-qa` / `npm run uat:full`), NOT warm `/ship`** (a pixel diff needs a running app + a fresh
  capture) — documented in `.claude/skills/design-qa/SKILL.md` §Visual regression.
- **Accept — a 4px misalignment → red diff.** `tests/harness/visual-regression.test.mjs` (4/4 via
  `npm run test:hooks`) proves it deterministically with synthetic PNGs: identical → 0 diff / PASS; a
  block shifted **4px** → ≥100 px differ / FAIL + a diff image; a dimension change → FAIL; a
  single-pixel nudge → within the 0.1% default tolerance / PASS. **Committed baseline + real CLI run:**
  `docs/verification/v2-305-copy/baseline/` (the accepted desktop captures) diffed against the
  identical current set → `2 baseline(s), 0 regression(s)`, exit 0.

## Per-phase retros

### Phase 0 retro — "Trust the gates" (V2-001 … V2-006)

- **What worked:** the shared `scope-cover.mjs` extraction let V2-001 (bash) and V2-002 (blueprint)
  apply one coverage implementation; jscpd/complexity gates don't scan `.claude/`, so new hooks
  added no duplication/complexity risk. The hook harness (V2-003) doubles as the negative-test
  evidence vehicle for V2-001/002 and a permanent regression net.
- **What broke / friction:** `/ship`'s gitleaks gate needs the `gitleaks` binary, which was absent
  and whose GitHub release asset is egress-blocked by proxy policy — installed from source via
  `go install` (module proxy allowlisted) into `~/.local/bin` (ephemeral; see SESSION-HANDOFF).
  Prettier flagged the verbatim kickoff/backlog artifacts — resolved by `.prettierignore` (they are
  the re-audit contract, must stay byte-identical).
- **What was learned / deferred:** readers already tolerated session-state.json absence, so V2-006
  was mostly formalization + skeleton-regen, not reader surgery. Fork-pruning of session-state.json
  is Phase 5 (V2-506), noted in the branch-only docs. No Phase 0 findings-register waivers were
  needed (no pillar concerns left unfixed).
- **Exit criteria (KICKOFF §3 row 0):** hook suite green in `/ship` phase A ✓; Bash heredoc→route
  DENIED (transcript) ✓; over-broad Scope globs rejected ✓; Superpowers enabled + presence check ✓;
  README + SECURITY §15 match reality ✓.

### Phase 1 retro — "Cheapen every session" (V2-101 … V2-107)

- **The win, measured (`scripts/context-tax.mjs`):** SessionStart always-on injection **36868B →
  19751B (19.29KB)**, under the 20KB exit budget. Constitution **25098B → 8183B** (≤8KB). The
  reduction is real load taken off every single session, not a one-time cost — the whole point of
  the phase. Domain detail now loads lazily from `.claude/rules/*.md` only when a matching path is
  touched (`rules-injection.mjs`), with a diff-accounted mapping table proving **zero rule-content
  loss** (the V2-101 senior review caught two dropped ADRs + six under-matching globs here — fixed,
  now guarded by a mechanical ADR-diff hook test).
- **What worked:** every gate item got a negative test in the same commit (`hooks.test.mjs` grew
  19 → 42), so "the budget is enforced" is a red-on-regression fact, not a claim. The review rail
  paid for itself repeatedly — it caught a **real security hole** (V2-107 force-delete via flag
  combo), a **false-disjoint bug in the V2-105 `/fan-out` gate itself** (its glob-overlap heuristic
  would have passed a colliding manifest — exactly what the custom verdict was chosen to prevent;
  fixed to a sound intersection test), a fictional 9-hook latency measurement (V2-103), and a
  prefix-collision in the digest matcher (V2-102). Context depth was visibly taxing my own quality;
  the adversarial post-push pass is what kept the phase honest.
- **What broke / friction:** the **8KB constitution ceiling was the dominant friction** — nearly
  every content addition pushed it over 8192B and needed trimming (dozens of micro-edits). Worth it
  (the ceiling is the product), but the constitution is now near-saturated: future always-on
  additions must evict something. The **handoff auto-status is the volatile budget-eater** (8797B of
  the 19751B total, ~250B of headroom left) — a verbose `nextActions` run can breach 20KB, so it
  needs periodic pruning (already trimmed once this phase). Routing receipts don't populate for
  async background-Agent dispatch in this env (logged, scheduled).
- **The V2-105 ASK — recommendation overridden, honestly recorded:** the analysis recommended
  _native_ (no skill, ADR-034 grounds); the operator's verdict was _custom_. Both the recommendation
  and the override are preserved in ADR-057 — the ASK is the operator's call to make, and `/fan-out`
  shipped because they made it. `/fan-out` adds the one thing native genuinely lacks: **enforced**
  file-ownership (overlap-refusal + post-wave scope-verify).
- **Exit criteria (KICKOFF §3 row 1):** SessionStart context ≤20KB measured (19.29KB) ✓;
  constitution split into constitution + path-globbed rule files with zero-loss mapping table ✓;
  memory retrieval-on-demand (V2-102 digest) in place ✓; parallel-by-default live in the
  constitution (V2-104) ✓; R9 native-agent-teams evaluation written up with a verdict (ADR-057,
  verdict = custom, `/fan-out` built) ✓.

### Phase 2 retro — "Complete the loop" (V2-201 … V2-210)

- **The win:** the development loop is now a **single traceable pipeline** — benchmark → explore →
  blueprint (parity + app-floor + DAG) → parallel implement → two-stage review → BDD-verified ship →
  retro — proved end-to-end by the Asset Tracker pilot. Each station is a real skill/gate, not a
  habit: `/benchmark`, `/explore`, `/retro` are shipped skills; parity/app-floor/DAG/amendment are
  blueprint sections a `/ship` gate enforces; two-stage review is in the reviewer's protocol;
  story→test coverage is machine-checked by `bdd-coverage`.
- **What worked:** **Wave 1 dogfooded the whole parallel stack at once** — three write-disjoint skills
  (`/benchmark`, `/explore`, `/retro`) dispatched as a real subagent wave through `/fan-out`;
  `check-overlap` passed, the agents ran concurrently, `verify-scope` came back clean. That single
  wave is the live evidence for V2-104 (parallel-by-default), V2-105 (`/fan-out` enforcement), and
  V2-205 (a wave executed with ownership sets respected) — the machinery reviewing itself. Building
  the checks as **pure, unit-tested cores** (`blueprint-content.mjs`, `bdd-coverage.mjs`) meant every
  new `/ship` gate shipped with a red-on-regression test in the same commit.
- **What broke / friction:** the **scaffold's path convention diverged from the blueprint** — it
  generated singular `app/api/asset/**` where the blueprint had assumed plural `assets` + a
  `lib/services` layer that the template doesn't use (routes call `prisma` directly). Caught before
  review by reading the actual generated tree; the blueprint was corrected to match reality (Scope,
  architecture, DAG). Lesson: **write the blueprint's Scope against the generator's real output**, not
  an assumed layout — or scaffold first, then pin Scope. Second friction: **no Docker/DB in this
  env** meant the migration was generated offline via `prisma migrate diff --from-schema/--to-schema`
  (schema-to-schema, no DB) and the db-structure in-sync check degrades to a warn — honest, but a real
  DB would verify sync.
- **What was missing (omission → fed forward):** the pilot ships only a **table-stakes slice** — three
  ITAM table-stakes (Model→Category hierarchy, custom fields, bulk CSV import) are DEFERRED, logged in
  `docs/findings-register.md` as `status: scheduled` and dispositioned in the blueprint's parity
  section. That is the `/retro` omission-feedback loop working: what the pilot didn't build is recorded
  against the benchmark it was measured on, so it re-surfaces rather than being silently dropped.
- **The V2-207 ASK — brought to the operator, then closed:** the analysis shipped ADR-058 as
  _Proposed_ and surfaced the playwright-bdd adoption as an explicit `AskUserQuestion`. **The operator
  accepted** — so `playwright-bdd` is now installed and the executor wired (`playwright-bdd.config.ts`,
  `bdd:gen`/`test:bdd`; `bddgen` verified generating the pilot's spec), ADR-058 → Accepted. The owned
  `bdd-coverage` checker was always dependency-free; the executor rode the sign-off. The **enforced**
  coverage flip still rides `/ship --full` (V2-401, Phase 4); warm `/ship` untouched.
- **Exit criteria (KICKOFF §3 row 2):** the pilot runs benchmark → explore → blueprint(+DAG) →
  implement → two-stage review → ship → retro end-to-end ✓ (every station evidenced above); its
  story→test coverage is machine-verified via `bdd-coverage` — every US1-US4 maps to a scenario, and
  an unimplemented scenario (deleted step def) fails ✓; the playwright-bdd executor generates the
  runnable specs (`bddgen`) ✓. _Caveat honestly recorded:_ scenario EXECUTION against a browser needs
  a live app + seeded DB + per-role auth (not in the build container) — that run lands with `/ship
--full` in Phase 4; the coverage MAPPING + spec GENERATION are verified now.
