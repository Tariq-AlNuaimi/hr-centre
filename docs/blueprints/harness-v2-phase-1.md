# Blueprint — HARNESS-V2 Phase 1: "Cheapen every session"

Status: **CONFIRMED** (operator sign-off 2026-07-16 — KICKOFF §2.1 / step 5)
Track: **Full** · Tier: repo is `personal` (`project.config.json`), but Phase 1 rewrites the
constitution + adds gates, so the elevated KICKOFF ceremony (negative tests, evidence manifest,
register lines) applies regardless.
Confirmed: 2026-07-16 — operator resolved: **Q1 = `.claude/rules/*.md`** (path-glob header files
referenced from the constitution); **Q2 = rename Pillar 1 → "Speed & Velocity"**; **Q4 = proceed
with the 7-item plan as drafted** (V2-101 first; V2-106/V2-107 the parallel `[P]` demo pair).
**Q3 (V2-105 build-vs-native verdict)** deferred to the mid-phase ADR-057 `ASK`.
Program: harness-v2 · Phase: 1 · Backlog items: V2-101 … V2-107

Scope: CLAUDE.md, .claude/rules/**, .claude/hooks/session-start.sh, .claude/hooks/context-watchdog.mjs, .claude/settings.json, .claude/skills/fan-out/**, scripts/ship.mjs, scripts/context-tax.mjs, project.config.json, docs/agent-memory.md, docs/token-policy.md, docs/uat-rubric.md, docs/decisions/ADR-057-parallel-execution-mechanism.md, docs/decisions/ADR-054-*.md, docs/build-vs-buy-ledger.md, docs/findings-register.md, docs/HARNESS-V2-EVIDENCE.md, docs/blueprints/harness-v2-phase-1.md, package.json, tests/harness/**

---

## 1. Why this phase (theme)

Phase 1 is **"cheapen every session."** Phase 0 made the gates trustworthy; this phase makes
every session that runs against them cheap and fast. The audit's speed-pillar finding: the
SessionStart context tax is ~47KB before a single prompt (CLAUDE.md 25KB auto-loaded +
agent-memory.md 16.7KB surfaced whole + the handoff auto-status block ~5KB), most of it rules
that are irrelevant to the file the agent is about to touch. The fix is structural, not
compression (supersedes "caveman compression"): a small always-on constitution, domain rules
that load lazily by path, memory surfaced as a digest and retrieved on demand — plus the
standing instructions that make sessions cheap in wall-clock too (parallel-by-default), the
pillar that makes velocity a *gate* rather than a vibe, and the observability (ccusage) to
measure the win.

Exit criterion (KICKOFF §3, row 1): SessionStart injected context ≤ 20KB measured (`wc -c`
before/after); CLAUDE.md split into constitution + path-globbed rule files with **zero
rule-content loss** (diff-accounted mapping table); memory retrieval-on-demand in place;
parallel-by-default rule live in the constitution; R9 (native agent-teams) evaluation written
up with a verdict.

## 2. User stories

- **US1.1 (agent, every session):** As the agent, I want only the constitution (≤8KB) plus the
  rule files relevant to the paths I'm touching loaded into context, so I spend tokens on the
  task, not on prisma rules while editing a React component. *(V2-101)*
- **US1.2 (re-auditor):** As the re-auditor, I want a mapping table proving every rule line in
  the old 25KB CLAUDE.md still lives somewhere (constitution or a rule file), so the split is
  verifiably lossless, not a quiet deletion. *(V2-101)*
- **US1.3 (agent):** As the agent, I want agent-memory surfaced as a ≤30-line digest with
  full sections fetched only when a lookup is relevant, so a growing memory file stops taxing
  every session. *(V2-102)*
- **US1.4 (operator):** As the operator, I want development **velocity** to be a gated pillar
  (context-size, `/ship` wall-time, hook latency) so speed regressions surface mechanically the
  way security regressions do, instead of drifting silently. *(V2-103)*
- **US1.5 (agent):** As the agent, I want a binding standing instruction to decompose
  multi-part work and dispatch write-disjoint units as parallel subagents in one message
  without being asked, so wall-clock (Pillar 1) is spent, not idled. *(V2-104)*
- **US1.6 (operator / maintainer):** As the maintainer, I want a recorded, evidence-backed
  decision on whether to use Claude Code's **native agent teams** or build a custom `/fan-out`
  orchestrator, so the parallel mechanism is chosen on data, not assumption. *(V2-105)*
- **US1.7 (operator):** As the operator, I want per-session/model token spend visible via a
  `npm run tokens` command, so the "cheapen every session" claim is measurable. *(V2-106)*
- **US1.8 (operator):** As the operator, I want the permission deny-list re-evaluated so safe,
  high-friction ops (`git branch -d`, `git commit --amend` on unpushed HEAD) stop prompting,
  while force-push/reset stay denied. *(V2-107)*

## 3. Scenarios (happy + worst path per item)

**V2-101 — constitution split**
- *Happy:* new session; SessionStart injects constitution (≤8KB) + digest; agent opens
  `lib/prisma/audit-extension.ts`, the prisma rule file loads, SCRUB_FIELDS rule is present;
  total auto-injected bytes ≤20KB (`wc -c` evidence, before/after).
- *Worst:* a rule that used to be in CLAUDE.md (e.g. `no-raw-sql-unsafe`) is silently dropped in
  the split → caught by the mapping table's completeness check (every old line-range maps to a
  new home) and a grep sweep proving each of the 11 ESLint rules + each Hard rule still appears
  in exactly one home. A rule file with a bad path glob never loads → a smoke check confirms
  each rule file loads on a representative path.

**V2-102 — memory retrieval-on-demand**
- *Happy:* SessionStart prints only the ≤30-line digest; `grep`-ing a section header pulls the
  full section on demand; `/remember` appends to a section and regenerates the digest.
- *Worst:* memory grows unbounded again → session-start warns when the digest >30 lines or any
  section >60 lines (mechanical budget, demonstrated on a synthetic over-budget fixture).

**V2-103 — velocity pillar**
- *Happy:* constitution + `docs/uat-rubric.md` state Pillar 1 covers runtime speed AND dev
  velocity; the three checks (context-size warn, `/ship` wall-time >25% warn, hook-latency
  baseline) fire on synthetic regressions.
- *Worst:* the wall-time warn fires on cold-cache noise → warn (never block), compares against a
  recorded warm baseline in `project.config.json`, and is a >25% band, not a hair-trigger.

**V2-104 — parallel-by-default**
- *Happy:* text lands in the constitution; demonstrated once this phase on a real ≥2-unit
  write-disjoint task (e.g. the `[P]` items V2-106/V2-107) with routing receipts as evidence.
- *Worst:* parallelizing a dependency chain corrupts state → the instruction's calibration notes
  ("dependency chains don't parallelize; orchestrator-only during waves") + file-ownership sets
  prevent overlap.

**V2-105 — native agent-teams evaluation**
- *Happy:* `ADR-057` records native/custom/hybrid with evidence of the native feature's tested
  behavior + the operator's confirmed verdict; `/fan-out` built only if the verdict is "custom".
- *Worst:* building `/fan-out` when native already suffices → the ADR gates the build; no skill
  is written unless the verdict is custom.

**V2-106 — ccusage**
- *Happy:* ledger entry recorded; `npm run tokens` prints a per-session/model spend report for
  this program's sessions.
- *Worst:* ccusage unavailable offline / egress-blocked → wrapper fails soft with a clear
  message; the ledger entry names the fallback (local JSONL log analyzer).

**V2-107 — permission friction**
- *Happy:* `.claude/settings.json` diff allows `git branch -d` and (if expressible)
  `git commit --amend` on unpushed HEAD; each change carries a one-line rationale in the commit.
- *Worst:* an amend rewrites pushed history → keep the amend denial if "unpushed HEAD" isn't
  expressible in the permission matcher, and document why in the commit body.

## 4. Architecture sketch

**Context-tax pipeline (the measurable target).**
```
SessionStart injection today (~47KB):
  CLAUDE.md (25KB, auto-loaded)  +  agent-memory.md whole (16.7KB)  +  handoff auto-status (~5KB)

After Phase 1 (≤20KB target):
  CLAUDE.md constitution (≤8KB, auto-loaded)
  + agent-memory DIGEST (≤30 lines, ~2-3KB)
  + handoff auto-status (~5KB, unchanged)
  + [lazy] .claude/rules/<domain>.md — loaded ONLY when a matching path is touched
  ─────────────────────────────────────────────────────────────────
  measured by scripts/context-tax.mjs (new): sums the always-on bytes, prints before/after.
```

**Proposed rule-file layout (`.claude/rules/`)** — mechanism confirmed in §7 Q1:
| Rule file | Loads on paths | Content moved from CLAUDE.md |
|---|---|---|
| `prisma.md` | `prisma/**`, `lib/prisma/**` | Go-through-Prisma, no raw SQL, SCRUB_FIELDS, audit/soft-delete invariants, `prismaUnfiltered` |
| `api-routes.md` | `app/api/**` | auth wrappers, zod-at-boundary, rate-limit-outside-auth, internal-route rules |
| `design.md` | `components/**`, `app/**/*.tsx` | UI Definition of Done, design-system read, token/no-raw-hex rules |
| `deploy.md` | `scripts/**`, `vercel.json`, `next.config.ts` | deploy rails, migrate-deploy cadence, Docker artifact rule |
| `ai.md` | `lib/ai/**`, `app/api/ai/**` | AI-Quality pillar, `no-direct-anthropic-sdk`, eval gate |
| `harness.md` | `.claude/**`, `eslint-rules/**`, `scripts/ship.mjs` | ESLint-rule roster, gate quartet, ship-before-push |

The constitution keeps: identity, the Five Pillars (terse), the Hard-rules *summary* + Ask-before
surface (these are cross-cutting and must always be present), standing instructions (terse EARS),
and a one-line pointer to each rule file. **Zero-loss rule:** every domain-specific *detail* moves
to a rule file; the constitution keeps the *always-true* floor. The mapping table (old
line-range → new home) is the proof, committed to `docs/HARNESS-V2-EVIDENCE.md`.

**Velocity gate wiring (V2-103).** Three checks, all *warn* (Pillar-1 is a gate but these
sub-checks are fail-open velocity signals, per KICKOFF §2.5 friction budget):
1. `scripts/context-tax.mjs` — SessionStart/`/ship` phase-A: warn if always-on bytes > budget.
2. `scripts/ship.mjs` — warn if warm run wall-time > 125% of `project.config.json` baseline.
3. hook-latency: measure UserPromptSubmit+PreToolUse chain once, record baseline, warn threshold.

**Parallel mechanism (V2-104/V2-105).** V2-104 is the *instruction* (constitution text). V2-105 is
the *mechanism decision* (ADR-057). `/fan-out` is built only if the ADR says "custom".

## 5. Item plan & sequence (V2-101 FIRST, then the rest)

1. **V2-101** (do first — everything after benefits): split CLAUDE.md → constitution + rule files
   + mapping table. Gate check: constitution ≤8KB, total ≤20KB, grep sweep for path validity.
2. **V2-102** memory digest + budget warn.
3. **V2-103** velocity pillar text + the 3 checks + recorded baselines.
4. **V2-104** parallel-by-default constitution text.
5. **V2-105** native-teams research → ADR-057 → **ASK verdict** → `/fan-out` only if custom.
6. **V2-106** `[P]` ccusage ledger + `npm run tokens`.
7. **V2-107** `[P]` permission deny-list review.
   → V2-106 + V2-107 are write-disjoint `[P]` → **demonstrate V2-104** by running them as
   parallel subagents (routing receipts = V2-104 evidence).

Each item: acceptance criterion demonstrated (command/test/transcript), evidence row in
`docs/HARNESS-V2-EVIDENCE.md`, commit `harness-v2(V2-1NN): <summary>`. Gate items (V2-101 budget,
V2-102 budget warn, V2-103 checks) get negative tests. Phase ends: `/ship` green → push → verify
→ Phase 1 retro appended to the evidence file.

## 6. Tier & gates touched

- No new `app/api/**/route.ts` or `app/**/page.tsx` → blueprint-gate not tripped by this phase.
- ccusage (V2-106) is a **dev-dependency** → build-vs-buy ledger entry required (no ADR, per
  KICKOFF §2.3 dev-dep rule); wrapper only, no runtime code.
- `.claude/settings.json` permission edits (V2-107) are Ask-before surface → covered by this
  blueprint's confirmation + per-change rationale.
- New velocity checks must not add >2s to warm `/ship` (KICKOFF §2.5 friction budget) — the
  context-tax + wall-time checks are `wc -c`/timestamp arithmetic (sub-100ms); recorded as
  evidence.

## 7. Open questions (must resolve before implementation — `ASK`)

**Q1 (V2-101, ASK structure review) — lazy-rules mechanism.** Which mechanism for path-globbed
loading?
- **(a, recommended)** `.claude/rules/<domain>.md` files with a path-glob header, referenced from
  the constitution — cleanest separation, one file per domain, explicit globs.
- **(b)** Nested `CLAUDE.md`/`AGENTS.md` files in subdirectories (`app/api/CLAUDE.md`,
  `lib/prisma/CLAUDE.md`) — uses Claude Code's built-in nested-memory loading, no new mechanism.
- **(c)** Constitution + `@import` references resolved on demand.
  → also confirm the **≤8KB constitution boundary**: keep Five Pillars + Hard-rules summary +
  Ask-before always-on (recommended), or push more into lazy files.

**Q2 (V2-103, ASK wording) — velocity pillar framing.** Rename Pillar 1 "Speed" →
**"Speed & Velocity"** (recommended: explicit) or keep the name "Speed" and expand its definition
to cover dev velocity? And confirm the >25% `/ship` wall-time warn band.

**Q3 (V2-105, ASK verdict) — timing.** This ASK fires *after* the research/ADR-057 draft, not now
— I'll research native agent teams, draft the ADR with evidence, and bring the build-vs-native
verdict back to you mid-phase. Flagging so it's expected.

**Q4 (scope check).** Confirm Phase 1 scope is the 7 items as planned, with V2-101 done first and
V2-106/V2-107 run as the parallel-demo pair.

---

*Confirmation block (operator fills on sign-off): resolved Q1=___ Q2=___ Q4=___; Q3 deferred to
mid-phase ADR-057 verdict.*
