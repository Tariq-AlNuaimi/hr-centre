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

| ID     | Phase | Status  | Commit(s) | Evidence                                                                                | Notes                                                                                                                                                 |
| ------ | ----- | ------- | --------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-001 | 0     | done    | 32d1f9d   | [detail](#v2-001-evidence) · `tests/harness/hooks.test.mjs`                             | Bash write-gate: heredoc→new route DENIED, covered ALLOWED, `rm -rf` unchanged                                                                        |
| V2-002 | 0     | done    | 32d1f9d   | [detail](#v2-002-evidence) · `tests/harness/hooks.test.mjs`                             | Scope-glob hygiene: over-broad+expired don't cover; specific does; existing pass                                                                      |
| V2-003 | 0     | done    | 32d1f9d   | [detail](#v2-003-evidence) · `tests/harness/hooks.test.mjs`                             | Hook harness: 18/18 green; /ship phase-A `hooks`; mutation→RED demonstrated                                                                           |
| V2-004 | 0     | done    | 32d1f9d   | [detail](#v2-004-evidence)                                                              | Superpowers enabled + SessionStart presence check (both states shown)                                                                                 |
| V2-005 | 0     | done    | 22baea3   | [detail](#v2-005-evidence)                                                              | Docs truth: AntD→shadcn/Radix; eleven rules; §15 test-flag corrected                                                                                  |
| V2-006 | 0     | done    | 32d1f9d   | [detail](#v2-006-evidence)                                                              | session-state.json branch-only + SessionStart skeleton-regen; readers absence-tolerant                                                                |
| V2-101 | 1     | done    | (this)    | [detail](#v2-101-evidence) · `tests/harness/hooks.test.mjs` · `scripts/context-tax.mjs` | Constitution 25098→8184B (≤8KB); always-on 36868→19954B (≤20KB); lazy `.claude/rules/*.md` via `rules-injection.mjs`; mapping table below (zero loss) |
| V2-102 | 1     | pending | —         | —                                                                                       | Memory retrieval-on-demand                                                                                                                            |
| V2-103 | 1     | pending | —         | —                                                                                       | Velocity becomes a gated pillar (ASK)                                                                                                                 |
| V2-104 | 1     | pending | —         | —                                                                                       | Parallel-by-default standing instruction                                                                                                              |
| V2-105 | 1     | pending | —         | —                                                                                       | Native agent-teams evaluation (ASK)                                                                                                                   |
| V2-106 | 1     | pending | —         | —                                                                                       | Token observability: ccusage (LEDGER)                                                                                                                 |
| V2-107 | 1     | pending | —         | —                                                                                       | Permission friction review                                                                                                                            |
| V2-201 | 2     | pending | —         | —                                                                                       | /benchmark <category> skill                                                                                                                           |
| V2-202 | 2     | pending | —         | —                                                                                       | Feature-parity disposition in the blueprint                                                                                                           |
| V2-203 | 2     | pending | —         | —                                                                                       | Universal app-floor checklist                                                                                                                         |
| V2-204 | 2     | pending | —         | —                                                                                       | /explore divergent skill                                                                                                                              |
| V2-205 | 2     | pending | —         | —                                                                                       | Work-graph in the blueprint                                                                                                                           |
| V2-206 | 2     | pending | —         | —                                                                                       | Two-stage review                                                                                                                                      |
| V2-207 | 2     | pending | —         | —                                                                                       | playwright-bdd traceability (LEDGER, ADR, ASK)                                                                                                        |
| V2-208 | 2     | pending | —         | —                                                                                       | /retro skill + omission feedback                                                                                                                      |
| V2-209 | 2     | pending | —         | —                                                                                       | Blueprint amendment deltas                                                                                                                            |
| V2-210 | 2     | pending | —         | —                                                                                       | Pilot feature end-to-end (ASK)                                                                                                                        |
| V2-301 | 3     | pending | —         | —                                                                                       | Visual iteration loop                                                                                                                                 |
| V2-302 | 3     | pending | —         | —                                                                                       | Layout primitive layer (LEDGER)                                                                                                                       |
| V2-303 | 3     | pending | —         | —                                                                                       | Page archetypes                                                                                                                                       |
| V2-304 | 3     | pending | —         | —                                                                                       | Spacing/typography lint (LEDGER)                                                                                                                      |
| V2-305 | 3     | pending | —         | —                                                                                       | Copy chokepoint + copy lint                                                                                                                           |
| V2-306 | 3     | pending | —         | —                                                                                       | OSS catalog + /adopt skill                                                                                                                            |
| V2-307 | 3     | pending | —         | —                                                                                       | Taste anchors + scored design-qa (ASK)                                                                                                                |
| V2-308 | 3     | pending | —         | —                                                                                       | Visual regression (LEDGER)                                                                                                                            |
| V2-309 | 3     | pending | —         | —                                                                                       | Build-vs-buy completeness                                                                                                                             |
| V2-401 | 4     | pending | —         | —                                                                                       | Testcontainers + /ship --full (LEDGER)                                                                                                                |
| V2-402 | 4     | pending | —         | —                                                                                       | pgvector verification                                                                                                                                 |
| V2-403 | 4     | pending | —         | —                                                                                       | Coverage floor                                                                                                                                        |
| V2-404 | 4     | pending | —         | —                                                                                       | Cognitive complexity at error (LEDGER)                                                                                                                |
| V2-405 | 4     | pending | —         | —                                                                                       | Mutation testing on invariants (LEDGER)                                                                                                               |
| V2-406 | 4     | pending | —         | —                                                                                       | Invariant unit tests                                                                                                                                  |
| V2-407 | 4     | pending | —         | —                                                                                       | Local security fallbacks (LEDGER)                                                                                                                     |
| V2-408 | 4     | pending | —         | —                                                                                       | protect-secrets scope honesty                                                                                                                         |
| V2-409 | 4     | pending | —         | —                                                                                       | Debt sunset                                                                                                                                           |
| V2-501 | 5     | pending | —         | —                                                                                       | ADR-056 decision (ASK, ADR)                                                                                                                           |
| V2-502 | 5     | pending | —         | —                                                                                       | Renovate (LEDGER)                                                                                                                                     |
| V2-503 | 5     | pending | —         | —                                                                                       | Skill-standard conformance                                                                                                                            |
| V2-504 | 5     | pending | —         | —                                                                                       | Docs-currency skill                                                                                                                                   |
| V2-505 | 5     | pending | —         | —                                                                                       | Doctrine sync + maintainer runbook                                                                                                                    |
| V2-506 | 5     | pending | —         | —                                                                                       | Fork doc-payload manifest                                                                                                                             |
| V2-507 | 5     | pending | —         | —                                                                                       | Program closeout                                                                                                                                      |

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
