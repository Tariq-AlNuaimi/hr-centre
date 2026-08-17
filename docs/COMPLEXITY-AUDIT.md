# Template complexity audit — where the weight is and what to cut

**Date:** 2026-08-17 · **Branch:** `claude/template-complexity-audit-dqxq52` · **Scope:** every
tracked file in the repo (590 files, 10.99 MB).

**The complaint being investigated:** the template has grown heavy enough that agents lose the
thread — context fills with governance, and regressions follow.

**The verdict:** the complaint is correct and measurable. The template spends **~18.9K tokens of
every context window before the operator types a word**, and its own context meter reports only
**2.9K** of that — a **6.4× under-report**. The governance layer is now **2.7× the size of the
product it governs**. Three specific mechanisms (below) account for most of it, and all three are
fixable without giving up the security floor.

---

## 1. The headline numbers

| Measure                                                 | Value                      | Comment                                   |
| ------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| Tracked files                                           | **590**                    | —                                         |
| Tracked bytes                                           | **10.99 MB**               | 6.7 MB (61%) is committed PNG screenshots |
| Product code (`app`+`components`+`lib`+`i18n`+`prisma`) | **14,466 lines**           | the thing a fork actually ships           |
| Harness code (`.claude`+`scripts`+`eslint-rules`+CI)    | **23,860 lines**           | 1.6× the product                          |
| Docs (markdown)                                         | **14,872 lines**           | 1.0× the product                          |
| Tests                                                   | **15,534 lines**           | 1.1× the product                          |
| **Harness + docs ÷ product**                            | **2.7×**                   | **the core finding**                      |
| True always-on context tax                              | **75.6 KB ≈ 18.9K tokens** | measured below                            |
| What `scripts/context-tax.mjs` reports                  | 11.8 KB ≈ 2.9K tokens      | **under-reports by 6.4×**                 |

The product surface a fork inherits is genuinely small: **15 pages, 13 API routes, 60 components,
26 lib modules, 5 Prisma models**. Everything else is machinery around those 119 files.

---

## 2. The real always-on context tax

This is what is present in the model's window at turn zero, before any file is read. Empirically
verified against this session's own system prompt.

| Source                                             | Bytes      | ~Tokens    | Counted by `context-tax.mjs`? |
| -------------------------------------------------- | ---------- | ---------- | ----------------------------- |
| `.claude/rules/*.md` — **all six, loaded eagerly** | 32,788     | 8,197      | ❌ **no**                     |
| 34 skill descriptions (frontmatter)                | 16,024     | 4,006      | ❌ no                         |
| MCP: 4 servers / ~160 tools (names + instructions) | ~9,000     | ~2,250     | ❌ no                         |
| `CLAUDE.md` (constitution)                         | 8,185      | 2,046      | ✅ yes                        |
| `AGENTS.md`                                        | 3,411      | 852        | ❌ no                         |
| `agent-memory.md` digest                           | 2,772      | 693        | ✅ yes                        |
| SessionStart banner + handoff status tables        | 2,036      | 509        | ✅ yes (partial)              |
| 4 agent definitions (name + description)           | ~1,400     | ~350       | ❌ no                         |
| **TOTAL**                                          | **75,616** | **18,904** | **3 of 8 sources**            |

### 2.1 The single biggest defect: lazy rules aren't lazy

`.claude/rules/*.md` was designed as **path-lazy** loading — `rules-injection.mjs` injects the
matching rule file as `additionalContext` when you edit a matching path, explicitly so the rules
do not "tax every session's SessionStart context" (the hook's own comment says exactly this).

**It does not work.** Claude Code auto-discovers `.claude/rules/*.md` as project-instruction files
and loads **all six** into the system prompt at session start — verified in this session's own
system prompt, where all six appear labelled `(project instructions, checked into the codebase)`.

Two consequences:

1. The 32.8 KB the design was built to avoid is paid **on every session anyway** — it is the
   **largest single line item**, bigger than the constitution it was split out of.
2. `rules-injection.mjs` then injects the same rule file **a second time** on every matching
   `Edit`/`Write`. Frequently-edited surfaces (`app/**/*.tsx` → `design.md`, 4.1 KB) get
   **double-billed** repeatedly through a session.

`harness.md` alone is **19,883 bytes / 275 lines** — bigger than `CLAUDE.md`, and it loads
unconditionally even for a session that never touches the harness.

### 2.2 The meter is blind

`context-tax.mjs` measures `CLAUDE.md` + memory digest + handoff tables, and reports **"OK vs
20KB"**. It sees none of the rules, skills, MCP, or agent surface. **The gauge reads green while
the tank is 6× over.** This is the same "degrades quietly, reads green forever" failure the harness
already documented for `db-structure` — the lesson was written down and then repeated.

---

## 3. Full inventory

### 3.1 `.claude/` — the harness (65 files, 481 KB, 8,713 lines)

| Component          | Count  | Size                | Notes                                                   |
| ------------------ | ------ | ------------------- | ------------------------------------------------------- |
| Skills             | **34** | 304 KB              | 16 KB of descriptions always-on                         |
| Hooks              | **16** | 92 KB / 1,753 lines | 6 can **deny** a tool call                              |
| Rules              | 6      | 32.8 KB             | all eagerly loaded (§2.1)                               |
| Agents             | 4      | 385 lines           | scout · senior-code-reviewer · security-architect · sre |
| `settings.json`    | 1      | 5.5 KB              | 46 allow + 18 deny permission entries                   |
| `skill-rules.json` | 1      | 7.8 KB              | skill-activation glob table                             |

**Hooks firing per turn:** 1 `UserPromptSubmit`, **5 on every Edit/Write**, **4 on every Bash**,
2 `PostToolUse`, 1 `Stop`, 1 `PreCompact`, 2 `SessionEnd`.

**Skills by size** (body loads on invoke; description always-on):

| Skill           |    Body | Skill                                                                                                                          |     Body | Skill        |   Body |
| --------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------ | -------: | ------------ | -----: |
| blueprint       | 22.8 KB | new-project                                                                                                                    |  10.3 KB | migrate-from | 4.7 KB |
| manual-uat      | 22.1 KB | audit                                                                                                                          |  10.3 KB | retro        | 4.5 KB |
| scale-up        | 21.1 KB | qa                                                                                                                             |   9.7 KB | adopt        | 4.4 KB |
| uat             | 19.8 KB | deploy                                                                                                                         |   8.6 KB | ai-eval      | 4.2 KB |
| handoff         | 16.3 KB | explore                                                                                                                        |   8.2 KB | benchmark    | 4.2 KB |
| ship            | 14.0 KB | fan-out                                                                                                                        |   8.2 KB | docs-current | 3.9 KB |
| design-qa       | 13.1 KB | stack-advisor                                                                                                                  |   8.1 KB | rebrand      | 3.6 KB |
| scaffold-entity | 12.4 KB | first-fork                                                                                                                     |   8.1 KB | adr          | 2.7 KB |
|                 |         | quickstart / design-system / scaffold-ai-endpoint / sync-from-template / handoff-session / conform / remember / cover / docker | 5–7.5 KB | batch        | 2.7 KB |

### 3.2 `docs/` — 138 files, 5.91 MB, 14,872 lines

| Item                          | Count / size              | Assessment                                  |
| ----------------------------- | ------------------------- | ------------------------------------------- |
| `docs/verification/**` PNGs   | **4.81 MB**               | committed screenshots; cloned by every fork |
| `docs/decisions/` ADRs        | **62 files, 475 KB**      | ADR-001…ADR-062, no `superseded/` split     |
| `docs/recipes/**`             | 15 files, **4,655 lines** | opt-in recipes, none wired by default       |
| `docs/findings-register.md`   | 615 lines, 59 KB          | **0 open wave-offs** — all history          |
| `docs/build-vs-buy-ledger.md` | 642 lines, 49 KB          | **42 entries** for 26 lib modules           |
| `docs/design-recipes.md`      | 557 lines                 |                                             |
| `docs/uat-rubric.md`          | 243 lines                 |                                             |
| `docs/OPEN-ITEMS.md`          | 166 lines                 | ~half the rows are `✅ DONE` / `MOOT`       |
| `docs/repo-architecture.md`   | 158 lines                 | overlaps orientation + REPO-MAP             |
| `docs/REPO-MAP.md`            | 143 lines                 |                                             |
| `docs/token-policy.md`        | 114 lines                 | overlaps `harness.md`                       |
| `docs/harness-orientation.md` | 98 lines                  | overlaps repo-architecture                  |
| `docs/ARCHIVE.md`             | 94 lines                  |                                             |
| `docs/oss-catalog.md`         | 81 lines                  |                                             |
| `docs/blueprints/`            | 7 files, 51 KB            |                                             |
| `docs/runbooks/`              | 7 files, 42 KB            |                                             |

### 3.3 `scripts/` — 51 files, 12,037 lines

| Script                     |     Lines | Script                  |        Lines |
| -------------------------- | --------: | ----------------------- | -----------: |
| `ship.mjs`                 | **1,851** | `fan-out.mjs`           |          283 |
| `scaffold-entity.mjs`      |     1,587 | `ai-eval.mjs`           |          242 |
| `deploy.mjs`               |       669 | `render-handoff.mjs`    |          227 |
| `uat-pdf.mjs`              |       633 | `copy-check.mjs`        |          196 |
| `new-project.mjs`          |       591 | `agent-eval.mjs`        |          190 |
| `rbac-matrix.mjs`          |       454 | `bdd-coverage.mjs`      |          182 |
| `enable-docs-site.mjs`     |       362 | `capture-screens.mjs`   |          154 |
| `browser-bridge.mjs`       |       344 | `auto-spawn-guard.mjs`  |          151 |
| `scaffold-ai-endpoint.mjs` |       340 | `sbom-license-gate.mjs` |          148 |
| `uat-recommend.mjs`        |       336 | `visual-regression.mjs` |          147 |
| `sync-from-template.mjs`   |       334 | + 30 more               | 100–145 each |

### 3.4 Gates — the enforcement surface

| Gate                           | Mechanism       | Blocks?  | Required artifact                      |
| ------------------------------ | --------------- | -------- | -------------------------------------- |
| build-vs-buy (ADR-032)         | PreToolUse hook | **deny** | ledger entry + `Considered:` line      |
| blueprint (ADR-033)            | PreToolUse hook | **deny** | `docs/blueprints/<f>.md` with `Scope:` |
| bash-write-gate                | PreToolUse hook | **deny** | mirrors the two above for Bash writes  |
| dangerous-commands             | PreToolUse hook | **deny** | —                                      |
| protect-secrets                | PreToolUse hook | **deny** | —                                      |
| verbose-guard                  | PreToolUse hook | **deny** | —                                      |
| complexity (ADR-034)           | `/ship` phase   | RED      | `complexityAck` + register line        |
| ai-eval (ADR-036/042)          | `/ship` phase   | RED      | dormant without `AI_API_KEY`           |
| 13 local ESLint rules          | lint            | error    | —                                      |
| `sonarjs/cognitive-complexity` | lint            | error    | —                                      |
| `/code-review` (2-stage)       | pre-push        | blocking | —                                      |
| `senior-code-reviewer`         | post-push       | advisory | —                                      |

**`/ship` warm loop runs ~22 phases**: typecheck · lint · format · tests · scalability · copy ·
wave-offs · licenses · tier · session-state · blueprint · blueprint-content · complexity ·
db-structure · knip · duplication · coverage · skill-check · build · size-limit · gitleaks ·
npm-audit · ai-eval. `ship:full` adds docker · trivy · BDD · integration · SBOM.

### 3.5 Other

| Item                 | Count                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| npm scripts          | **68**                                                                                              |
| runtime dependencies | 41                                                                                                  |
| devDependencies      | 37                                                                                                  |
| ADRs                 | 62                                                                                                  |
| GitHub workflows     | 13 (most dormant)                                                                                   |
| MCP servers / tools  | 4 / ~160                                                                                            |
| Test files           | 74 (29 contract, 16 uat, 9 agent-eval, 8 component, 5 harness, 3 property, 2 integration, 2 eslint) |

---

## 4. Where the fat actually is

Five structural problems, in order of damage to the agent:

**F1 — Eager rules (8.2K tokens/session).** §2.1. The lazy design is defeated and the cost is
double-billed. This is the highest-value fix in the repo.

**F2 — The instruction layer restates itself 4–6 times.** The same hard rules appear in
`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`, `docs/harness-orientation.md`,
`docs/repo-architecture.md`, `docs/token-policy.md`, and each SKILL.md preamble. `AGENTS.md`
is explicitly "a pointer, not the source of truth" yet re-states the auth/Prisma/zod/secrets/audit
rules verbatim in 3.4 KB of always-on context. Redundancy is not free: an agent reading the same
rule in six phrasings spends tokens reconciling them, and drifts when they disagree.

**F3 — 34 skills is past the discrimination limit.** 16 KB of always-on descriptions, and the set
overlaps heavily: `qa` / `design-qa` / `uat` / `manual-uat` / `cover` are five entry points to
testing; `blueprint` / `explore` / `benchmark` / `adopt` are four to pre-build analysis;
`deploy` / `new-project` / `first-fork` / `quickstart` are four to provisioning. Every extra
description both costs tokens and makes routing less accurate.

**F4 — Ceremony that no longer discriminates.** 42 build-vs-buy ledger entries against 26 lib
modules means the gate fires more often than it finds anything; a gate that is always satisfied by
writing a line is a tax, not a filter. `findings-register.md` carries **0 open wave-offs** in 615
lines — it is a 59 KB archive occupying a hot path. Half of `OPEN-ITEMS.md` is `DONE`/`MOOT`.

**F5 — 6.7 MB of committed binaries.** `docs/verification/**` (4.81 MB) + UAT snapshots (1.9 MB)
are **61% of the repo by bytes** and are cloned into every fork forever. The visual-iteration loop
(V2-301) is sound; committing its full output matrix to the template's permanent history is not.

---

## 5. Cut list — prioritized

Ordered by (context saved) ÷ (risk). **Nothing here touches the security floor**: the auth
wrappers, zod boundary, 13 ESLint rules, audit log, gitleaks, and `/ship`-before-push all stay
exactly as they are.

### Tier 1 — do these first (~11.5K tokens/session, ~60% of the tax, near-zero risk)

| #      | Cut                                                | Saves             | How                                                                                                                                                                                                                                                                                                                                                            |
| ------ | -------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | **Stop the eager rules load**                      | **~8.2K tok**     | Move `.claude/rules/*.md` out of auto-discovery — rename to `.claude/rules/*.rule.md` or relocate to `docs/rules/`, and point `rules-injection.mjs` at the new path. The hook already does the lazy injection correctly; it just needs the CLI to stop pre-loading the same files. **Verify by inspecting the next session's system prompt, not by assuming.** |
| **C2** | **Split `harness.md` (19.9 KB)**                   | folds into C1     | It is a maintainer manual, not a rule. Keep ~40 lines of genuinely binding rules; move the rest (shadow-DB recipe, ship-tier tables, ESLint rationale, memory-lifecycle history) to `docs/runbooks/maintainer.md`, loaded on demand.                                                                                                                           |
| **C3** | **Delete `AGENTS.md`'s duplicated rules**          | ~850 tok          | Reduce to a genuine 15-line pointer: "read `CLAUDE.md` and `SECURITY.md`." It says it is a pointer; make it one.                                                                                                                                                                                                                                               |
| **C4** | **Prune MCP servers to what a session needs**      | ~1.5–2K tok       | 4 servers / ~160 tools load schema surface every session. `chrome-devtools` and `playwright` are near-duplicates for browser QA — keep one. Move `shadcn` + `context7` to opt-in. The SessionStart banner already warns about this; act on the warning.                                                                                                        |
| **C5** | **Fix `context-tax.mjs` to measure all 8 sources** | 0 tok, high value | Without this you cannot tell whether C1–C4 worked. Add rules, skill descriptions, agent definitions, MCP surface, and `AGENTS.md`. Set the budget to a number the repo actually meets — and **make the degraded state visibly distinct**, per the repo's own db-structure lesson.                                                                              |

### Tier 2 — consolidation (~3K tokens/session, low risk)

| #      | Cut                                             | Saves           | How                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C6** | **34 skills → ~18**                             | ~7 KB desc      | Merge: `qa` absorbs `design-qa`+`uat`+`manual-uat`+`cover` as modes; `blueprint` absorbs `explore`+`benchmark`+`adopt`; `deploy` absorbs `new-project`+`first-fork`; `handoff` absorbs `handoff-session`. Fold `adr`, `remember`, `rebrand`, `batch`, `docs-current` into the skills that call them. Modes are a flag, not a separate always-on description. |
| **C7** | **Archive the cold governance docs**            | ~1 KB + clarity | `findings-register.md` → keep open items only, move 615 lines of resolved history to `docs/archive/`. Same for `OPEN-ITEMS.md` (drop DONE/MOOT rows) and `build-vs-buy-ledger.md`.                                                                                                                                                                           |
| **C8** | **Merge the three overlapping map docs**        | clarity         | `repo-architecture.md` + `harness-orientation.md` + `token-policy.md` → one `docs/ARCHITECTURE.md`. Keep `REPO-MAP.md` separate (it is the cheap "where is X" lookup and earns its place).                                                                                                                                                                   |
| **C9** | **Split ADRs into `active/` and `superseded/`** | clarity         | 62 ADRs with no supersession structure; ADR-023 is already superseded by ADR-030, ADR-027 by ADR-029. An agent searching ADRs currently reads dead decisions as live ones.                                                                                                                                                                                   |

### Tier 3 — structural (highest long-term payoff, needs your decision)

| #       | Cut                                              | Rationale                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C10** | **Move the 6.7 MB of PNGs out of git**           | Keep the visual-iteration loop; stop committing its full matrix. Keep one reference set for `design-system`; write the rest to a gitignored `docs/verification/` and retain only the `CRITIQUE.md` text. Forks stop inheriting 6.7 MB of someone else's screenshots.                                                                |
| **C11** | **Collapse `/ship` from ~22 phases to ~12 warm** | Move `knip`, `duplication`, `coverage`, `skill-check`, `size-limit`, `db-structure`, `copy` to `ship:full`. Warm `/ship` should be: typecheck · lint · format · tests · build · gitleaks · npm-audit · scalability · complexity · blueprint · tier · wave-offs. Faster loop = more loops = fewer regressions (Pillar 1).            |
| **C12** | **Retire the build-vs-buy hook gate**            | 42 entries / 26 modules, all with `Considered:` lines, 0 recorded reversals. The _scan_ is valuable; the _deny_ is theater. Downgrade to a `/ship` warning, or scope the deny to new **runtime dependencies** only — which is where build-vs-buy actually bites.                                                                    |
| **C13** | **Cut `scripts/` from 51 to ~30**                | Candidates to fold or drop: `agent-eval.mjs`, `auto-spawn-guard.mjs`, `auto-spawn-fire.mjs`, `hook-latency.mjs`, `routing-report.mjs`, `uat-recommend.mjs`, `uat-benchmark.mjs`, `enable-docs-site.mjs`, `enable-api-reference.mjs`, `install-senior-review.mjs`. Each carries an npm script, docs, and a mention in some SKILL.md. |
| **C14** | **68 npm scripts → ~35**                         | Follows from C11 + C13.                                                                                                                                                                                                                                                                                                             |
| **C15** | **Reduce Edit/Write hooks from 5 to 2–3**        | Five hooks fire on every single edit. `skill-activation` + `rules-injection` can merge (the code comments note they share glob/relPath logic verbatim); `build-vs-buy-gate` folds into `bash-write-gate`'s pattern or goes away with C12.                                                                                           |

### Projected result

|                        |     Now | After Tier 1 | After Tier 1+2 | After all |
| ---------------------- | ------: | -----------: | -------------: | --------: |
| Always-on tokens       | ~18,900 |       ~7,400 |         ~4,500 |    ~4,000 |
| Skills                 |      34 |           34 |             18 |        18 |
| Warm `/ship` phases    |      22 |           22 |             22 |        12 |
| Repo bytes             | 11.0 MB |      11.0 MB |        11.0 MB |   ~4.3 MB |
| Harness+docs ÷ product |    2.7× |         2.7× |          ~2.2× |     ~1.5× |

**Tier 1 alone recovers ~11.5K tokens per session** — roughly 60% of the tax — and is mostly file
moves plus one hook path change.

---

## 6. The principle worth adopting

Every mechanism in this repo was individually justified — each has an ADR, each closed a real gap.
The failure is that **nothing was ever removed**, and no mechanism had to prove it was still
earning its cost. Three guardrails would have prevented this audit:

1. **A budget that is actually measured.** `context-tax.mjs` had a 20 KB budget and reported
   "OK" at 75 KB because it measured a third of the inputs. A budget you cannot measure honestly
   is worse than no budget — it manufactures false confidence. (C5.)
2. **Gates must discriminate.** A gate satisfied 42 times out of 42 by writing a line is a toll
   booth. Track how often each gate _changes an outcome_; retire the ones that never do. (C12.)
3. **Every addition names what it replaces.** New ADR, new skill, new hook, new doc — say what it
   supersedes or delete-by. Without that, the harness only grows.

The security floor is not the problem here and should not be touched. **The governance layer
around it is, and it is roughly 3× larger than it needs to be.**
