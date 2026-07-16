# HARNESS-V2 — Program Backlog

Derived from the July 2026 external audit (structural, enforcement, methodology, pillar,
piece-level benchmark passes). 71 raw findings collapsed to 45 actions across 6 phases.
IDs are stable and trace back to the audit conversation. `[P]` groups within a phase are
write-disjoint and may run as parallel subagents. `ASK` = operator decision required.
`ADR` = requires a new/superseding ADR. `LEDGER` = requires build-vs-buy ledger entry.

Legend for acceptance criteria: all must be demonstrated per KICKOFF §5 (command output /
test / transcript / screenshot), never asserted.

---

## PHASE 0 — Trust the gates

### V2-001 (was #1) — Close the Bash bypass on the write gates
Extend `dangerous-commands.mjs` (already Bash-matched, fail-closed) OR add a sibling
fail-open governance hook on the Bash matcher: detect shell writes (`>`, `>>`, `tee`,
heredoc, `cp`/`mv` into repo, `sed -i` creating files) whose resolved target matches the
blueprint-gate surface (`app/api/**/route.ts` new, `app/**/page.tsx` new) or the
build-vs-buy surface (new `lib/**.ts` outside exclusions). Apply the SAME checks the Write
hooks apply (blueprint Scope coverage / ledger Scope coverage). Keep governance denials
fail-open, per house pattern; do not weaken the fail-closed destructive-command logic.
- Accept: transcript shows `bash -c 'cat > app/api/x/route.ts <<EOF ... EOF'` DENIED with
  the blueprint-gate reason when no covering blueprint exists; same command ALLOWED once a
  covering blueprint exists; `rm -rf` denial behavior unchanged.
- Files: `.claude/hooks/dangerous-commands.mjs` or new `.claude/hooks/bash-write-gate.mjs`
  + `.claude/settings.json`.

### V2-002 (was M3) — Blueprint Scope-glob hygiene
In `blueprint-gate.mjs` (and the mirrored `/ship` blueprint check): reject/ignore
over-broad Scope globs. Rule: a glob matching more than one top-level feature area
(`app/**`, `app/api/**`, `lib/**`, bare `**`) does not count as coverage; emit the deny
reason explaining glob specificity. Lightweight stubs additionally carry a
`Expires: YYYY-MM-DD` line (default +30 days); expired stubs do not count. Grandfather
existing blueprints by adding compliant Scope lines where needed.
- Accept: a stub with `Scope: app/**` does NOT satisfy the gate (transcript); a stub with
  `Scope: app/api/widgets/**` does; an expired stub does not; existing repo blueprints
  still pass `/ship`.

### V2-003 (was #2) — Hook test harness
New `tests/harness/*.test.mjs` (node:test): for EVERY hook in `.claude/hooks/`, pipe
synthetic hook-input JSON (PreToolUse Write/Bash/Read shapes, Stop with/without
`stop_hook_active`, SessionEnd, PreCompact) via stdin to the hook process; assert
deny/allow/block/warn decisions and the fail-open vs fail-closed behavior ON A FORCED
INTERNAL ERROR (e.g. point CLAUDE_PROJECT_DIR at a broken fixture). Minimum: both gates'
deny+allow paths, V2-001's new paths, dangerous-commands fail-closed, protect-secrets deny
on `cat .env` and on `printenv AUTH_SECRET`, session-stop block-once semantics.
Wire as `npm run test:hooks` + a `/ship` phase-A entry (same result shape as other checks).
- Accept: `npm run test:hooks` green; `/ship` output shows the `hooks` check; mutating a
  hook to always-allow turns the suite red (demonstrate once, revert).
- Depends: V2-001, V2-002 (test their final behavior).

### V2-004 (was #3) — Superpowers presence
Add `superpowers` to `enabledPlugins` in `.claude/settings.json` (marketplace source as
required). Add a SessionStart check (in `session-start.sh`) that warns loudly when the
plugin is not available in the session. CLAUDE.md line 40 gains: "verified at SessionStart".
- Accept: settings diff; session-start output shows the check firing in both states
  (simulate absence by name mismatch in a scratch copy).

### V2-005 (was #6 + #13) — Documentation truth pass `[P]`
README: Ant Design 6 → shadcn/Radix per ADR-029; "Ten" → eleven ESLint rules; re-verify
the whole feature list against the codebase (RSC dashboard, API v1, etc.). SECURITY.md
§15: delete/replace the stale claim that plain `npm test` lacks
`--experimental-test-module-mocks` (package.json passes it). Sweep both files for any
other claim contradicted by code; list each fix in the commit body.
- Accept: `grep -i "ant design" README.md` → only historical/ADR references if any;
  rule count correct; §15 note matches package.json.

### V2-006 (was #16) — session-state.json lifecycle `[P]`
Move `docs/session-state.json` off `main`-tracked state: either gitignore + regenerate at
SessionStart, or relocate under the SESSION-HANDOFF "committed to branch, never merged"
rule. Update every reader (`ship.mjs` end-of-run sync noted at ~line 1350, statusline,
auto-spawn-guard) to the new location/lifecycle. Keep `program`/`autoSpawn` functionality.
- Accept: `git ls-files docs/session-state.json` empty on main-path (or documented
  branch-only rule); `/ship` and statusline still function.

Phase 0 exit: KICKOFF table row 0, all evidenced.

---

## PHASE 1 — Cheapen every session

### V2-101 (was R1 + Speed-pillar context tax) — Constitution split + lazy rules  ASK(structure review)
Restructure CLAUDE.md into: (a) a ≤8KB constitution — identity, the Five Pillars (see
V2-103), Hard rules, Ask-before, standing instructions in maximally terse EARS-style
statements; (b) path-globbed lazily-loaded rule files (Claude Code rules mechanism) for
domain rules: design rules load on `components/**`+`app/**`, deploy rules on `scripts/**`,
prisma rules on `prisma/**`+`lib/prisma/**`, etc. ZERO rule-content loss: produce a
mapping table (old CLAUDE.md line-range → new home) in the evidence file. agent-memory.md
and token-policy.md surfacing reviewed under the same budget.
- Accept: constitution ≤8KB; total SessionStart auto-injected bytes ≤20KB (before/after
  `wc -c` evidence); mapping table complete; `/ship`, gates, and skills still reference
  valid paths (grep sweep).
- Depends: nothing, but do FIRST in phase — everything after benefits.

### V2-102 (was R6 + memory-over-budget) — Memory retrieval-on-demand
Restructure `docs/agent-memory.md` into indexed sections with a ≤30-line surfaced digest
(section headers + one-liners) at SessionStart; full sections retrieved by grep/read when
relevant. `/remember` appends to sections and regenerates the digest. Enforce the line
budget mechanically: session-start warns when digest >30 lines or any section >60.
- Accept: SessionStart shows digest only; a test lookup retrieves a full section; budget
  warning demonstrated.

### V2-103 (Speed-pillar definition) — Velocity becomes a gated pillar  ASK(wording)
Amend the Five Pillars (constitution + `docs/uat-rubric.md`): Pillar 1 "Speed" explicitly
covers BOTH runtime speed and development velocity. Automatable slice: (a) SessionStart
context-size check (V2-101's budget, warn); (b) `/ship` wall-time regression warn (>25%
over the recorded warm baseline in `project.config.json`); (c) hook-latency note — measure
UserPromptSubmit+PreToolUse hook chain once, record baseline, warn threshold. Also
de-duplicate skill-activation's double run if measurement shows it material.
- Accept: rubric + constitution updated; the three checks demonstrably fire on synthetic
  regressions; baselines recorded.

### V2-104 (was P1) — Parallel-by-default standing instruction
Constitution addition (binding): before any multi-part task, decompose; if ≥2 units are
write-disjoint, dispatch parallel subagents in a single message without being asked; each
unit rides its ADR-022 tier; file-ownership sets are mandatory per spawned unit;
parallelism trades tokens for wall-clock and wall-clock is Pillar 1. Include the two
calibration notes: dependency chains don't parallelize; orchestrator-only during waves.
- Accept: text landed; demonstrated once on a real 2+-unit task in this program with
  routing receipts as evidence.

### V2-105 (was R9, supersedes P3 pending verdict) — Native agent-teams evaluation  ASK(verdict)
Research Claude Code's native agent teams (shared tasks, messaging, team lead) against the
planned `/fan-out` orchestrator: capability, cost, availability in the operator's plan.
Write `docs/decisions/ADR-057-parallel-execution-mechanism.md` recommending native /
custom / hybrid. Build `/fan-out` ONLY if the ADR concludes custom (then: DAG-wave
orchestration, file-ownership sets, single `/ship` at wave end).
- Accept: ADR committed with verdict + evidence of the native feature's tested behavior;
  if custom: `/fan-out` SKILL.md + demonstrated run.

### V2-106 — Token observability: ccusage  LEDGER `[P]`
Adopt ccusage (or equivalent local-log analyzer) for per-session/model spend. Add
`npm run tokens` wrapper. This is ADR-054's "budget line" trigger-enabler; note in the ADR
that routing-report promotion (was M10) re-activates when the operator sets a budget.
- Accept: ledger entry; command produces a spend report for the current program sessions.

### V2-107 (was #19) — Permission friction review `[P]`
Re-evaluate deny list: allow `git branch -d` (safe delete) and `git commit --amend` when
HEAD is unpushed (if expressible; else document why kept). Keep force-push/reset denials.
- Accept: settings diff + one-line rationale per change in commit body.

Phase 1 exit: KICKOFF table row 1.

---

## PHASE 2 — Complete the loop

### V2-201 (was B1) — `/benchmark <category>` skill
New skill: given app category, research 3–5 mature products (≥1 OSS; mine OSS routes/
schema/settings for the true feature list), output `docs/benchmarks/<category>.md` parity
matrix: table-stakes / differentiators / anti-features, each row sourced. Reuses the
existing `docs/benchmarks/enterprise-ui-and-app-skeleton.md` format conventions. Library
behavior: check `docs/benchmarks/` first; refresh when stale (>6 months) — was B3.
- Accept: skill file + one real matrix produced for the phase-2 pilot's category.

### V2-202 (was B2, supersedes M2) — Feature-parity disposition in the blueprint
Blueprint template gains a required Feature Parity section when a category benchmark
exists: every table-stakes row dispositioned IN(→story-ID) / DEFERRED(→register line) /
N/A(reason). `/ship`'s blueprint check (shared tier) and `blueprint-gate` remain unchanged;
enforcement is a `/qa` step-0 assertion + a lightweight `/ship` warn when a benchmark
exists but the section is absent.
- Accept: pilot blueprint shows the section; synthetic missing-section case produces the
  warn.

### V2-203 (was B4) — Universal app-floor checklist
Add to the blueprint template: per-list (search, filter, sort, saved views, pagination,
export, bulk actions, empty state), per-entity (detail, edit, audit, delete/restore),
per-app (nav logic, notifications seam, settings, help/onboarding, activity) — each
checked or N/A'd. Template-scaffolded floors (audit, soft-delete, DataTable) pre-marked.
- Accept: template diff; pilot blueprint uses it.

### V2-204 (was M1) — `/explore` divergent skill
Before the blueprint locks architecture: generate 2–3 materially different approaches,
trade-off table (pillars-aligned), recommend one, and auto-draft the losing options into
an ADR stub (`docs/decisions/`) so the decision is archaeologically recorded. Feeds the
blueprint's Architecture sketch + the "Reference consulted" line (was O4-lite: name the
studied same-stack OSS codebase or 'none exists').
- Accept: skill file; pilot run produced the trade-off table + ADR stub.

### V2-205 (was P4 + BMAD handoff piece) — Work-graph in the blueprint
Blueprint "decompose via writing-plans" step now emits a work DAG: items marked [P]/[S],
each with a file-ownership set and a role-lens (which rule files / context slices the
implementing agent receives — ui / api / auth / infra). This is the input V2-105's
mechanism consumes.
- Accept: pilot blueprint contains the DAG; at least one wave executed in parallel with
  ownership sets respected (receipts + diff provenance).

### V2-206 (was R4, implements M4) — Two-stage review
`/code-review` flow (and senior-code-reviewer brief) reordered: STAGE 1 spec-compliance —
diff surface vs blueprint Scope + stories (files outside any covering blueprint are
findings; behavior contradicting a story is a finding); STAGE 2 code quality. Update both
the native command guidance in CLAUDE.md/constitution and
`.claude/agents/senior-code-reviewer.md`.
- Accept: agent file diff; pilot review transcript shows the two stages; a planted
  out-of-scope file is caught at stage 1.

### V2-207 (was M5 + M8-partial) — playwright-bdd traceability  LEDGER ADR(testing-stack amendment)  ASK
Adopt playwright-bdd: blueprint Given/When/Then scenarios become `.feature` files with
`USn` tags; step definitions on the existing Playwright runner (fixtures/tracing kept).
Coverage becomes machine-verified: a story without a scenario, or a scenario without
steps, is a red. Wire into `/ship --full` (V2-401) not warm `/ship`. EARS phrasing offered
as the scenario standard (was R3) — note in the ADR.
- Accept: ADR (amending ADR-008/016) accepted by operator; pilot feature's stories all
  have passing scenarios; deleting one step definition turns the run red.

### V2-208 (was M13 + B6) — `/retro` skill + omission feedback
After `/qa` or phase end: structured retro (what broke / what was learned / what was
missing) → one-line durable entries into agent-memory sections; any "missing feature"
finding appended to the relevant `docs/benchmarks/<category>.md`. Used at every phase end
of THIS program.
- Accept: skill file; phase-0/1/2 retros exist in the evidence file; one omission
  demonstrably appended to a benchmark.

### V2-209 (was M6/R2) — Blueprint amendment deltas
Amendments to a signed-off blueprint append an OpenSpec-style delta block (was→now, date,
reason) and reset a `Confirmed:` marker the operator re-confirms; `/ship`'s blueprint
check warns on unconfirmed amended blueprints (shared tier: red).
- Accept: template + check diff; synthetic amended-unconfirmed case warns.

### V2-210 — Pilot feature end-to-end  ASK(pick the pilot)
Operator supplies a REAL feature (RSP module slice or aptitude-platform slice). Run the
full loop: /benchmark → /explore → /blueprint(+parity+floor+DAG) → parallel implement →
D1-lite screenshot check (pre-phase-3 manual version) → two-stage review → /ship --full
(if V2-401 landed; else /ship + integration manual) → /retro.
- Accept: the feature is live/mergeable; every loop station evidenced; this is the
  program's proof artifact.

Phase 2 exit: KICKOFF row 2.

---

## PHASE 3 — Shrink the decision space (design + adoption)

### V2-301 (was D1) — Visual iteration loop  — HIGHEST DESIGN PRIORITY
Standing rule + `/design-qa` "during-build" mode: after building/altering any screen, the
agent MUST run the dev server, capture Playwright screenshots (≥ desktop+mobile × light+
dark × en+ar when ar enabled), VIEW them, self-critique against the 10-point rubric
(V2-307), fix, re-capture. Screenshots stored `docs/verification/<feature>/`. Affirmation
without attached captures is invalid (was D9).
- Accept: rule landed; one real screen's before/after capture set with critique notes.

### V2-302 (was D2, seeded by D6) — Layout primitive layer  LEDGER
`components/shared/`: PageShell, Section, Toolbar, FormLayout, StatGrid, DetailList,
EmptyState (extend existing where present). Primitives own ALL internal spacing/alignment
on the token scale. Seed from vetted shadcn blocks/registries through `/conform` + RTL
verification; port structures already designed in the operator's RSP migration where
provided.
- Accept: primitives exist with RTL+dark evidence captures; design-recipes updated to
  compose-first.

### V2-303 (was D3 + D10) — Page archetypes
Five canonical archetypes (list, detail, form, dashboard, settings) as full reference
implementations in `docs/design-recipes.md` + a `/style-guide`-adjacent demo route.
Blueprint design-read declares the archetype; non-archetype pages need a one-line design
rationale. Bake in the density rule (cards only for peer collections ≥2; else DetailList)
and RTL non-negotiables.
- Accept: archetype pages render (captures); pilot/next feature's blueprint declares one.

### V2-304 (was D4) — Spacing/typography lint  LEDGER
Adopt eslint-plugin-tailwindcss (or extend the local plugin): error on arbitrary values
(`p-[13px]`), off-scale spacing, raw font sizes outside tokens. Wire at `error`; sweep
existing violations or ack-waiver them per file with register lines.
- Accept: rule at error in eslint.config; planted violation fails lint; repo lint green.

### V2-305 (was D5) — Copy chokepoint + copy lint
Lint rule flagging literal JSX text (allowlist: aria/test ids/dev pages) → all UI strings
through next-intl messages. `/ship` copy check on `messages/*.json`: sentence case, no
trailing periods on labels/buttons, imperative button verbs, terminology consistency list.
- Accept: planted literal fails lint; planted "Submit Request." fails the copy check;
  existing strings migrated or waived.

### V2-306 (was O1+O2, includes B5) — OSS catalog + `/adopt` skill
`docs/oss-catalog.md` seeded per the audit's capability table (license, weight, self-host
flag, recipe, and the per-category feature-oracle OSS: Plane/Twenty/Documenso/Formbricks/
Cal.com). `/adopt <capability>`: catalog lookup → AskUserQuestion trade-offs → ledger
entry + ADR stub when runtime → install per recipe. Catalog lookup becomes step 0 of the
build-vs-buy scan (hook deny message updated to mention it).
- Accept: catalog committed; `/adopt` demonstrated on one real capability; gate message
  updated.

### V2-307 (was D7 + D9) — Taste anchors + scored design-qa  ASK(anchor choice)
`docs/design-references.md`: 2–3 exemplar products per archetype (operator picks; propose
Linear/Vercel/Stripe defaults) with annotated notes. `/design-qa` verdicts become a
numeric 10-point rubric (grid alignment, hierarchy, one-primary-action, state honesty,
spacing rhythm, copy, RTL, dark, responsive, a11y) citing the V2-301 captures.
- Accept: file committed with operator's picks; one scored design-qa run.

### V2-308 (was D8) — Visual regression  LEDGER `[P]`
Adopt Lost Pixel or Argos CE over the UAT screenshot set; baseline committed; diff run
wired as `/qa` tier or `uat:full` step (not warm `/ship`).
- Accept: baseline + a deliberate 4px misalignment produces a red diff.

### V2-309 (was #10 + M7) — Build-vs-buy completeness `[P]`
Extend gate surface to new files under `components/shared/**` and `scripts/**` (same
exclusions logic); ledger entries now require a `Considered:` line naming ≥1 alternative
(gate parses for it).
- Accept: transcripts for deny/allow on the new surfaces; entry without Considered: fails.

Phase 3 exit: KICKOFF row 3.

---

## PHASE 4 — Verify what was waived

### V2-401 (was #8 + #14-unblock) — Testcontainers + `/ship --full`  LEDGER
Adopt @testcontainers/postgresql with a pgvector-enabled image. `test:integration` runs
against an ephemeral container (no Neon egress). New `npm run ship:full` = warm `/ship` +
integration + playwright-bdd/uat lean + (V2-308 when cheap). CLAUDE.md/constitution states
exactly what warm green includes vs full green.
- Accept: `test:integration` green with Docker only; ship:full green; constitution line.

### V2-402 (was #14) — pgvector verification
Apply the pgvector migration on the container; round-trip an embedding write + `<=>`
query + HNSW plan check. Parameterize the vector dimension (env or config) with 1536
default; document the 1024-model trap. Flip both related wave-offs to `fixed(<commit>)`
WITH operator adjudication noted (ASK to confirm flipping).
- Accept: test file proving the round-trip; register lines updated.

### V2-403 (was #11) — Coverage floor
`--experimental-test-coverage` + line threshold on the contract suite in `/ship` phase A
(start at current measured level; record baseline; ratchet note in ADR-034 style).
- Accept: /ship shows coverage check; synthetic drop below floor reds.

### V2-404 (complexity-v2) — Cognitive complexity at error  LEDGER
eslint-plugin-sonarjs `cognitive-complexity` (threshold tuned to current codebase max+
headroom) + `max-lines` on modified-file surfaces — closes ADR-034's documented v2 gap.
Existing violations waived per-file with register lines or refactored if trivial.
- Accept: rule at error; planted complex function fails; repo green.

### V2-405 (was Quality/StrykerJS) — Mutation testing on invariants  LEDGER `[P]`
StrykerJS (command runner) scoped to `lib/prisma/audit-extension.ts` + `lib/api-helpers.ts`
+ `lib/password.ts`. Nightly/`/qa`-tier, not warm ship. Record initial mutation score;
kill surviving mutants that indicate real test gaps or register-waive.
- Accept: score recorded in evidence; ≥1 surviving-mutant analysis documented.

### V2-406 (was #12) — Invariant unit tests `[P]`
Unit tests for `lib/prisma/soft-delete-extension.ts` and `middleware.ts` routing (the
SECURITY.md §15 admitted holes). Prisma mocking kept minimal per the §15 rationale — test
the decision logic, not the ORM.
- Accept: tests green in contract suite; §15 table updated.

### V2-407 (was #26 + R7) — Local security fallbacks  LEDGER `[P]`
osv-scanner + Trivy binaries wired into `/audit` (self-install pattern like semgrep);
SBOM feeds osv-scanner. Evaluate anthropics/claude-code-security-review for the dormant
CI slot and record in `.github/workflows/` (dormant, documented).
- Accept: `/audit` run shows both scanners executing locally; workflow committed dormant.

### V2-408 (was #18) — protect-secrets scope honesty `[P]`
Either extend matcher to Write/Edit (deny secret-material writes into tracked files) or
correct the hook's over-claiming comment + add the gap to SECURITY.md §17. Prefer extend
if false-positive risk is manageable (.env.example editing must stay allowed).
- Accept: chosen path evidenced (deny transcript OR comment+doc diff).

### V2-409 (was #24 + #25) — Debt sunset `[P]`
antd type-shim: retirement note + target (post next DataTable refactor) in table-types.ts
header + register line. bcryptjs: add a maintenance query/script counting remaining `$2*`
hashes + a sunset condition ("remove when count=0 for 90 days") documented in
lib/password.ts + register line.
- Accept: both register lines + code annotations.

Phase 4 exit: KICKOFF row 4.

---

## PHASE 5 — Stack & steady state

### V2-501 (was #7 + #21) — ADR-056 decision  ASK  ADR
Present the Better Auth migration case (incl. 2FA/passkeys/magic-link plugins closing the
auth-depth gap) vs staying frozen, with a dated decision deadline. Execute the DECISION
RECORDING only in this program; the migration itself is a separate follow-on program if
chosen (do NOT migrate auth inside harness-v2).
- Accept: superseding/confirming ADR with operator's recorded choice + deadline.

### V2-502 (was #23) — Renovate  LEDGER
Renovate config honoring ADR-017: auto in-range PRs, majors grouped/labeled for quarterly
refresh, lockfile maintenance. Works via hosted app while Actions dormant.
- Accept: config committed; policy mapping to ADR-017 in the file comments.

### V2-503 (was R10 + #22-prep) — Skill-standard conformance
Validate/adjust all 28+ SKILL.md frontmatters against the agentskills.io open standard;
fix drift. Prepare (not publish) the plugin package per ADR-054 for the extractable gate
pattern.
- Accept: validator/checklist output all-green; plugin.json updated.

### V2-504 (was R11 + M9) — Docs-currency skill
Add a docs-lookup skill scoped to the locked stack (Next/Prisma/Tailwind/Auth lib/
Playwright): pull current docs before answering version-sensitive questions. Add
stack-advisor freshness line to the quarterly refresh ADR template.
- Accept: skill file; demonstrated lookup on one Prisma 7 API.

### V2-505 (was R12 + #27-lite) — Doctrine sync + maintainer runbook `[P]`
Quarterly stack-refresh ADR template gains a "platform doctrine sync" section (check
official best-practices/agent-teams/rules/skills features that obsolete custom harness
pieces — cite V2-105 as precedent). Add `docs/runbooks/maintainer.md`: how to evolve
gates/ADRs/hooks safely (the bus-factor floor).
- Accept: template diff + runbook committed.

### V2-506 (was #17) — Fork doc-payload manifest `[P]`
`docs/generated-manifest.json` (or sibling) gains an `inheritance` classification:
fork-inherited vs template-dev-history; `/rebrand` prunes the latter in forks (MOVE to an
archive branch reference, never delete from template main). SECURITY.md size review noted
for a future pass (out of scope to rewrite here).
- Accept: manifest classification complete; rebrand dry-run shows the prune list.

### V2-507 — Program closeout
`docs/HARNESS-V2-CLOSEOUT.md` per KICKOFF §6: per-phase retro, spend (ccusage), the three
deltas (context tax, warm /ship time, gate count), superseded-items map (below), and the
open-items list (anything deferred, with register lines).
- Accept: file complete; evidence manifest has zero empty-evidence rows for non-deferred
  items.

---

## Superseded-items map (commit into closeout)

| Original | Superseded by | Note |
|---|---|---|
| M2 market-scan check | V2-202 | parity disposition is stronger |
| M4 drift detection | V2-206 stage 1 | review-rail placement, Superpowers-proven order |
| M5 coverage matrix | V2-207 | machine-verified by construction |
| M10 routing-report gate | V2-106 note | reactivates on operator budget |
| M14 skill-eval cadence | V2-503/R8 note | official Skill Creator harness when adopted |
| P3 /fan-out | V2-105 verdict | build only if native teams insufficient |
| P5 utilization metrics | V2-106 | ccusage provides |
| caveman compression | V2-101 | structural fix > compression |
| D6 | V2-302 seeding | folded in |
| D9 | V2-301 + V2-307 | folded in |
| B3 | V2-201 library behavior | folded in |
| B5/O4 | V2-306 + V2-204 reference line | one research pass |
| O3 registry ladder | V2-302/V2-306 + /conform rule | folded in |
| O5 license gate | DEFERRED → register line | SBOM-based check, next program |
| P6 worktree recipe | DEFERRED → register line | document post-V2-105 |
| #20/M12 impl. subagents | V2-105 + V2-205 | mechanism + DAG deliver it |

## Explicit deferrals (open register lines required)
O5 license gate; P6 worktree recipe; #17 SECURITY.md full rewrite; #22 actual marketplace
publication; #27 full bus-factor program; Better Auth MIGRATION (if V2-501 chooses it);
uptime/Storybook recipes (#28) — catalog entries in V2-306 suffice for now.
