# Blueprint — HARNESS-V2 Phase 0: "Trust the gates"

Status: **DRAFT — awaiting operator confirmation** (KICKOFF §2.1 / step 5)
Track: **Full** · Tier: repo is `personal` (`project.config.json`), but Phase 0 modifies
governance + security gates, so the elevated KICKOFF ceremony (negative tests, evidence
manifest, register lines) applies regardless.
Confirmed: _pending_
Program: harness-v2 · Phase: 0 · Backlog items: V2-001 … V2-006

Scope: .claude/hooks/bash-write-gate.mjs, .claude/hooks/blueprint-gate.mjs, .claude/hooks/session-start.sh, .claude/hooks/auto-handoff.mjs, .claude/hooks/context-watchdog.mjs, .claude/settings.json, tests/harness/**, scripts/ship.mjs, scripts/render-handoff.mjs, scripts/auto-spawn-guard.mjs, scripts/auto-spawn-fire.mjs, package.json, README.md, SECURITY.md, CLAUDE.md, .gitignore, docs/session-state.json, docs/HARNESS-V2-EVIDENCE.md, docs/findings-register.md, docs/build-vs-buy-ledger.md, docs/blueprints/harness-v2-phase-0.md

---

## 1. Why this phase (theme)

Phase 0 is **"trust the gates."** The audit found the enforcement layer has holes and
untested behavior: a Bash write can slip past the Write-only blueprint/ledger gates; blueprint
`Scope:` globs can be arbitrarily broad and still "cover"; no test proves any hook actually
denies what it claims to; Superpowers is referenced but not verified present; and the docs make
several claims the code contradicts. Until the gates are trustworthy and tested, every later
phase builds on sand. Nothing here changes product behavior — it hardens the harness that
governs the rest of the program.

Exit criterion (KICKOFF §3, row 0): hook test suite exists and runs green in `/ship` phase A;
a Bash heredoc write to `app/api/**/route.ts` is DENIED (transcript captured); over-broad
blueprint `Scope:` globs are rejected; Superpowers enabled + SessionStart presence check;
README and SECURITY.md §15 match reality.

## 2. User stories

- **US0.1 (operator / re-auditor):** As the operator, I want a shell write to a gated path
  (`bash -c 'cat > app/api/x/route.ts <<EOF …'`) to be **denied** by the same blueprint/ledger
  checks the Write tool enforces, so the governance gates can't be bypassed by dropping to Bash.
- **US0.2 (operator):** As the operator, I want an over-broad blueprint `Scope:` glob
  (`app/**`, bare `**`) to **not** count as coverage, and stub blueprints to expire, so a lazy
  one-line stub can't wave a whole feature area past the blueprint gate forever.
- **US0.3 (maintainer):** As a harness maintainer, I want every hook exercised by an automated
  test — deny path, allow path, and fail-open-vs-fail-closed under a forced internal error — so
  a future edit that silently breaks a gate turns the suite red instead of shipping.
- **US0.4 (operator):** As the operator, I want the plugin the constitution depends on
  (Superpowers) declared in settings **and** its presence checked at SessionStart, so a session
  that lacks it warns loudly instead of silently degrading.
- **US0.5 (reader / re-auditor):** As anyone reading the docs, I want README and SECURITY.md to
  match the actual stack (shadcn/Radix not Ant Design; eleven ESLint rules; the real test flags),
  so the documentation is trustworthy evidence.
- **US0.6 (fork operator):** As someone who forks the template, I do **not** want to inherit the
  template's in-flight program state (`docs/session-state.json`), so a fork starts clean while the
  template's own status tooling keeps working.

## 3. Scenarios (happy + worst path)

### V2-001 — Bash write-gate

- **Happy:** `bash -c 'cat > lib/foo.ts <<EOF …'` with a covering ledger `Scope:` entry, or any
  Bash command that writes nothing to a gated path → **ALLOWED** (fail-open, silent).
- **Worst:** `bash -c 'cat > app/api/x/route.ts <<EOF …'` with **no** covering blueprint →
  **DENIED** with the blueprint-gate reason. Also worst: malformed/edge redirects
  (`tee`, `>>`, `sed -i`, `cp`/`mv` into a gated path); the hook must recognize the resolved
  target. Forced internal error (broken `CLAUDE_PROJECT_DIR`) → **fail-open (ALLOW)**, matching
  the house governance pattern — it must NOT start denying legitimate writes, and it must NOT
  weaken `dangerous-commands.mjs`'s fail-closed `rm -rf` behavior.

### V2-002 — Scope-glob hygiene

- **Happy:** `Scope: app/api/widgets/**` (one feature area, specific) satisfies the gate for a
  new `app/api/widgets/route.ts`. A non-expired stub with a specific glob counts.
- **Worst:** `Scope: app/**` or bare `**` (spans >1 top-level area) → does **NOT** count as
  coverage; deny reason explains glob specificity. An **expired** stub
  (`Expires: <past-date>`) → does not count. Existing repo blueprints must still pass `/ship`
  (grandfather them with compliant/specific Scope lines).

### V2-003 — Hook test harness

- **Happy:** `npm run test:hooks` green; `/ship` phase A shows a `hooks` check that PASSes.
- **Worst:** mutating any hook to "always allow" (or breaking a deny path) turns the suite RED
  (demonstrate once on a scratch copy, then revert). A forced internal error in a fail-closed
  hook (protect-secrets / dangerous-commands) must still DENY; in a fail-open hook (the gates)
  must still ALLOW — the tests assert both directions.

### V2-004 — Superpowers presence

- **Happy:** `superpowers` present in `enabledPlugins`; SessionStart prints a check confirming it.
- **Worst:** simulate absence (name mismatch in a scratch settings copy) → SessionStart prints a
  loud warning, does not crash the session (fail-open).

### V2-005 — Documentation truth pass

- **Happy:** `grep -i "ant design" README.md` returns only historical/ADR references (or none);
  rule count reads "eleven" everywhere; SECURITY.md §15 note matches `package.json`'s test script.
- **Worst:** none (doc-only, no runtime). The negative check is the grep assertions above.

### V2-006 — session-state.json lifecycle

- **Happy:** `/ship`, `render-handoff`, statusline, and auto-spawn all still function; the file no
  longer lands on `main` (or a documented branch-only rule governs it); a fresh clone with the
  file absent still boots (SessionStart regenerates a minimal skeleton).
- **Worst:** a reader that assumes the file exists must not crash when it's absent → each reader
  guarded / fail-open. `git ls-files docs/session-state.json` is empty on the main-path (or the
  branch-only rule is documented and enforced).

## 4. Architecture sketch (per item)

Grounding facts (from repo investigation):

- Gates emit `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
"permissionDecisionReason":"…"}}` and exit 0. `blueprint-gate.mjs` (~L56–76) and
  `build-vs-buy-gate.mjs` (~L61–73) share a `Scope:`-line parser + `globToRe` (`**`→`.*`,
  `*`→`[^/]*`). `blueprint-gate` denies a _new_ `^app/api/.+/route\.ts$` / `^app/.+/page\.tsx$`
  with no covering blueprint; `build-vs-buy-gate` denies a _new_ `lib/**` file (minus
  validations/prisma/tests/`.d.ts`) with no covering ledger entry.
- `dangerous-commands.mjs` is the existing Bash matcher, **fail-closed**, splitting on
  `|| && ; | \n`. `protect-secrets.mjs` is fail-closed on Read|Grep|Bash.
- `ship.mjs` phase-A checks return `{name, ok, out, secs}`, run via `Promise.all`, reported at
  ~L1231, failure-collected in a red array ~L1256.
- `docs/session-state.json` readers: `render-handoff.mjs`, `auto-spawn-guard.mjs` (sole writer),
  `auto-spawn-fire.mjs`, `context-watchdog.mjs` (indirect via render-handoff), `auto-handoff.mjs`,
  `session-start.sh` (re-renders), `ship.mjs` (existence check only). Statusline does **not**
  read it directly.

- **V2-001:** New **fail-open** governance hook `.claude/hooks/bash-write-gate.mjs` on the `Bash`
  matcher (added alongside `dangerous-commands.mjs`, not merged into it — keeps fail-closed logic
  untouched). It parses the command for shell writes (`>`, `>>`, `tee`, heredoc, `cp`/`mv` into
  repo, `sed -i` creating files), resolves the target path, and applies the **same** blueprint /
  ledger Scope checks as the Write gates (extract the shared Scope/glob logic into a small
  `.claude/hooks/lib/scope-cover.mjs` helper so V2-001 and V2-002 use one implementation — this
  is refactor _inside item scope_, not opportunistic). Wire into `settings.json` PreToolUse Bash.
- **V2-002:** In `blueprint-gate.mjs` (and the mirrored `/ship` blueprint check) reject globs
  spanning >1 top-level area (`app/**`, `app/api/**` treated as too broad when used as the sole
  coverage, bare `**`); emit a specificity deny reason. Lightweight stubs carry
  `Expires: YYYY-MM-DD` (default +30d); expired stubs don't count. Grandfather existing blueprints.
- **V2-003:** New `tests/harness/*.test.mjs` (node:test) piping synthetic hook-input JSON via
  stdin to each hook, asserting deny/allow/block/warn + fail-open/closed on a forced internal
  error (point `CLAUDE_PROJECT_DIR` at a broken fixture). `package.json` gains `test:hooks`;
  `ship.mjs` gains a phase-A `hooks` check with the standard `{name, ok, out, secs}` shape.
- **V2-004:** Add `superpowers` to `enabledPlugins`; add a SessionStart presence check + warning
  in `session-start.sh` (~L97–103 region); CLAUDE.md line ~40 gains "verified at SessionStart".
- **V2-005:** Edit README.md (L3, L10, L34, L146) and SECURITY.md (L292, L307) to reality; sweep
  both for other contradicted claims; each fix listed in the commit body.
- **V2-006:** **Recommended approach → the branch-only lifecycle** (see Open Questions). Move
  `docs/session-state.json` under the SESSION-HANDOFF "committed to branch, never merged to main"
  rule, add a documented rule + a SessionStart safety-regeneration of a minimal skeleton when the
  file is absent (so a fresh fork boots), and guard every reader against absence. Preserves the
  rich hand-authored `program`/`autoSpawn`/status content (which gitignore+regenerate-from-nothing
  would destroy).

## 5. Open questions (to resolve at confirmation)

1. **V2-006 lifecycle choice (the one real decision).** The backlog offers _either_ (a)
   gitignore + regenerate at SessionStart, _or_ (b) relocate under the branch-only "never merged
   to main" rule. **Recommendation: (b).** Rationale: the file holds rich, hand-maintained
   program state (directives, workstreams, 22 comparison categories) that cannot be regenerated
   from nothing; (a) would silently lose it. (b) keeps functionality, matches how
   `SESSION-HANDOFF.md` is already treated, and satisfies the accept criterion's "documented
   branch-only rule" branch. → **Please confirm (b), or direct me to (a).**
2. **V2-002 breadth threshold.** I'll treat a glob as "too broad" when it matches more than one
   top-level feature area — concretely: bare `**`, `app/**`, `lib/**`, `app/api/**`,
   `components/**`, `scripts/**` used as the _sole_ coverage token. A glob like
   `app/api/widgets/**` (names a specific feature) is fine. → Flag if you want a different line.
3. No Phase 0 backlog item is marked `ASK`; if implementation surfaces a genuine ambiguity or any
   deviation from an acceptance criterion, I stop and use AskUserQuestion (KICKOFF §2.9).

## 6. Execution plan, parallelization & evidence

Order respects dependencies; `[P]` groups are write-disjoint and run as parallel subagents with
the file-ownership sets below. Single `/ship` at phase end (green → push → verify → retro).

| Item         | Depends on     | Parallel group / ownership                                                                                                                                                | Negative test (mandatory — gate items)                                                       |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| V2-001       | —              | Wave A (owns `bash-write-gate.mjs`, `hooks/lib/scope-cover.mjs`, settings.json Bash block)                                                                                | heredoc write to `app/api/x/route.ts` DENIED w/o blueprint; ALLOWED with; `rm -rf` unchanged |
| V2-002       | —              | Wave A (owns `blueprint-gate.mjs`, `ship.mjs` blueprint-check fn)                                                                                                         | `Scope: app/**` stub does NOT cover; specific glob does; expired stub does not               |
| V2-005 `[P]` | —              | Wave A (owns `README.md`, `SECURITY.md`)                                                                                                                                  | grep assertions (no live Ant Design claim; "eleven"; §15 matches package.json)               |
| V2-006 `[P]` | —              | Wave A (owns `session-state.json`, `.gitignore`, `render-handoff.mjs`, `auto-spawn-guard.mjs`, `auto-spawn-fire.mjs`, `auto-handoff.mjs`, `session-start.sh` state-block) | reader survives file-absent; `git ls-files` empty on main-path                               |
| V2-004       | —              | Wave A (owns `settings.json` enabledPlugins, `session-start.sh` plugin-check, `CLAUDE.md` L40)                                                                            | simulated absence → loud warn, no crash                                                      |
| V2-003       | V2-001, V2-002 | Wave B (owns `tests/harness/**`, `package.json` test:hooks, `ship.mjs` phase-A entry)                                                                                     | mutate a hook to always-allow → suite RED (then revert)                                      |

Ownership caveat: V2-001, V2-004 both touch `.claude/settings.json` (different blocks: Bash hooks
vs `enabledPlugins`); V2-002, V2-003 both touch `scripts/ship.mjs` (blueprint-check fn vs phase-A
list). To avoid write races I will **serialize the settings.json and ship.mjs edits in the main
session** rather than in parallel subagents, and parallelize only the fully-disjoint doc/state
work (V2-005, V2-006) as `[P]` per the backlog markings. Wave B (V2-003) runs after Wave A since
it tests Wave A's final behavior.

Every item: acceptance demonstrated by captured command output / transcript / test run (never
assertion), linked in `docs/HARNESS-V2-EVIDENCE.md`; committed `harness-v2(V2-00X): <summary>`;
any deferral/deviation → dated `docs/findings-register.md` line. Phase closes with a retro appended
to the evidence file.

## 7. Explicitly out of scope (do not touch)

`prisma/migrations/*`; the 11 existing ESLint rules' behavior; `lib/auth.ts`; deleting any `docs/`
history; no dependency bumps beyond what an item requires; no product/UI changes. No refactor
beyond item scope (the one shared `scope-cover.mjs` extraction is in-scope for V2-001/002).
