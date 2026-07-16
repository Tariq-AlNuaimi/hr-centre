# HARNESS-V2 — Program Kickoff (Orchestrator Prompt)

**Repo:** fullstack-vibe-template · **Operator:** Tariq Al-Naaimi
**Program:** Remediation + capability program derived from an external piece-level audit (July 2026).
**Companion file:** `HARNESS-V2-BACKLOG.md` (the item register — the WHAT). This file is the HOW.
**Post-program:** the repo will be independently re-audited against the evidence manifest (§6). Assume every claim you make will be verified.

---

## 0. Your role

You are the program executor. You will implement the backlog in phase order, using this repo's own
harness to govern the work (blueprints, ledger, findings register, `/ship`, retro). You do not
decide scope — the backlog does. You do not skip verification — §5 defines it. Where an item is
marked `ASK`, you stop and use `AskUserQuestion` before proceeding.

## 1. Read before anything (in this order)

1. `CLAUDE.md` — the standing rules. They ALL apply to this program.
2. `HARNESS-V2-BACKLOG.md` — the full item register, phases, acceptance criteria.
3. `docs/findings-register.md`, `docs/build-vs-buy-ledger.md` — you will be appending to both.
4. `.claude/settings.json`, `.claude/hooks/*` — you are modifying the harness; understand it first.
5. `scripts/ship.mjs` — several items add phases/checks to it.

## 2. Binding execution rules

1. **The program governs itself through the harness.** Each phase begins with a committed
   `docs/blueprints/harness-v2-phase-<N>.md` (full track: stories, happy/worst scenarios,
   `Scope:` globs covering every file the phase touches). Each phase ends: `/ship` green →
   push → verify push landed → phase retro appended to `docs/HARNESS-V2-EVIDENCE.md`.
2. **One phase at a time. Phase order is binding** (0→1→2→3/4 interleavable→5). Do not start
   phase N+1 with phase N exit criteria unmet. Exception: doc-only items may be batched into
   any phase's closing commit.
3. **Every OSS adoption gets a `docs/build-vs-buy-ledger.md` entry** (Scope glob, alternatives
   considered, why adopt) BEFORE installation. Every new dev-dependency is recorded; any
   runtime dependency additionally requires an ADR (backlog marks these).
4. **Every deferral or deliberate deviation is a dated `docs/findings-register.md` line**,
   `status: open`, for the operator to adjudicate. Nothing is silently dropped or silently
   "improved upon."
5. **New gates follow the house pattern:** fail-open for governance, fail-closed for security;
   ack-waiver escape hatch (`<name>Ack` in `project.config.json` + adjudicated register line);
   tiered ceremony (personal tier warns where shared tier blocks) unless the backlog says
   otherwise. **Friction budget:** a new gate may not add >2s to warm `/ship` without a
   register line justifying it.
6. **Do not refactor beyond item scope.** No opportunistic rewrites, no dependency bumps outside
   the backlog, no style sweeps. The re-audit diffs commits against item scope.
7. **Parallelize where the backlog marks `[P]`-groups** (write-disjoint). Use subagents with
   explicit file-ownership sets; the main session orchestrates. Log spawns normally
   (routing receipts stay on).
8. **Model routing per ADR-022:** exploration/orientation → scout (haiku); implementation →
   sonnet; only R1 constitution redesign and R4 review-rail redesign justify opus-tier reasoning.
9. **ASK items:** #7/ADR-056 direction, playwright-bdd testing-stack ADR acceptance, D7 taste
   anchors selection, R9 outcome (build vs native), any deviation from an acceptance criterion.
   Use `AskUserQuestion`; record the answer in the phase blueprint.
10. **Never weaken an existing gate to make a new one pass.** If two gates conflict, stop and ASK.

## 3. Phase sequence and exit criteria (summary — full detail in backlog)

| Phase | Theme | Exit criterion (all must hold, with evidence) |
|---|---|---|
| 0 | Trust the gates | Hook test suite exists and runs green in `/ship` phase A; a Bash heredoc write to `app/api/**/route.ts` is DENIED (transcript captured); over-broad blueprint Scope globs are rejected; Superpowers enabled + SessionStart presence check; README and SECURITY.md §15 match reality. |
| 1 | Cheapen every session | SessionStart injected context ≤ 20KB measured (`wc -c` evidence, before/after); CLAUDE.md split into constitution + path-globbed rule files with zero rule-content loss (diff-accounted); memory retrieval-on-demand in place; parallel-by-default rule live in constitution; R9 evaluation written up with verdict. |
| 2 | Complete the loop | Pilot feature (operator supplies; ASK at phase start) runs benchmark → explore → blueprint(+DAG) → parallel implement → two-stage review → ship-full → retro, end-to-end; its story→test coverage is machine-verified via playwright-bdd (every USn maps to a scenario; unimplemented scenario = failing test). |
| 3 | Shrink the decision space | An agent-built page lands on a D3 archetype unprompted; screenshot self-critique loop (D1) evidenced with before/after captures at 2 breakpoints × light/dark × en/ar; zero arbitrary Tailwind values in new code (lint proof); all UI strings in messages files (lint proof); `/adopt` + `docs/oss-catalog.md` live. |
| 4 | Verify what was waived | Testcontainers runs `test:integration` + pgvector migration green locally (no Neon); the two pgvector/integration wave-offs flipped to `fixed(<commit>)`; `/ship --full` tier exists; coverage floor enforced; sonarjs cognitive-complexity at error; StrykerJS run on `lib/prisma/audit-extension.ts` + `lib/api-helpers.ts` with score recorded. |
| 5 | Stack & steady state | ADR-056 decision recorded (ASK); Renovate config committed; SKILL.md frontmatter conforms to agentskills.io standard (validator proof); docs-currency skill added; R12 doctrine-sync line added to the stack-refresh ADR template; superseded-items map committed. |

## 4. What you must NOT do

- Do not touch `prisma/migrations/*` except where an item explicitly says so (phase 4 pgvector).
- Do not modify the 11 existing ESLint rules' behavior; you may ADD rules.
- Do not change `lib/auth.ts` beyond ADR-056's recorded decision (phase 5, ASK-gated).
- Do not delete `docs/` history files; the fork-payload split (#17) MOVES via manifest, never deletes.
- Do not mark any findings-register line `adjudicated` — only the operator adjudicates.

## 5. Verification protocol (per item)

An item is DONE only when: (a) its acceptance criterion from the backlog is demonstrated by a
command output, test run, or captured transcript — not by assertion; (b) the evidence is linked
in `docs/HARNESS-V2-EVIDENCE.md`; (c) the work is committed with message
`harness-v2(<ITEM-ID>): <summary>` and pushed. Negative tests are mandatory for every gate item:
prove the gate DENIES the bad case AND ALLOWS the good case.

## 6. The evidence manifest (the re-audit contract)

Maintain `docs/HARNESS-V2-EVIDENCE.md` from the first commit. One row per item:

```
| ID | Phase | Status (done/deferred/superseded/blocked) | Commit(s) | Evidence | Notes |
```

Evidence = relative path to a test file, a captured command output block in the file itself, a
screenshot path under `docs/verification/harness-v2/`, or a register/ledger line reference.
Deferred/blocked items name the blocker and carry a register line. Superseded items point at
their successor ID. The re-audit will walk this table row by row; an empty Evidence cell is a
failed item regardless of the code.

Also produce at program end: `docs/HARNESS-V2-CLOSEOUT.md` — per-phase retro (what broke, what
was learned, wall-clock + token spend per phase from ccusage once installed), and the delta
summary: context-tax before/after, `/ship` warm time before/after, gate count before/after.

## 7. Session discipline

This program spans multiple sessions. At every session end: push (the Stop hook enforces it),
update `docs/SESSION-HANDOFF.md` with next-item pointer, and keep `docs/session-state.json`'s
`program` field at `harness-v2` with the current phase. A fresh session orients by reading this
file + the backlog + the evidence manifest — nothing else should be required.

Begin with Phase 0. First action: write `docs/blueprints/harness-v2-phase-0.md` and have the
operator confirm it.
