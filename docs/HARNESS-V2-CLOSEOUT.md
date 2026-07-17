# HARNESS-V2 — Program closeout

**Program:** harness-v2 · **Phases:** 0–5 (all complete) · **Items:** 48 (V2-001 … V2-507) ·
**Branch:** `claude/harness-v2-kickoff-yhid26` · **Closed:** 2026-07-17

harness-v2 hardened the template's agent harness across six phases: trust the gates, cheapen every
session, complete the loop, shrink the decision space, verify what was waived, and settle steady
state. Every item shipped `/ship`-green, was senior-reviewed at phase close, and landed on `main`.
Full per-item evidence: `docs/HARNESS-V2-EVIDENCE.md` (the manifest has **zero empty-evidence rows for
non-deferred items** — the V2-507 exit bar).

## Per-phase retro

- **Phase 0 — Trust the gates (V2-001…006).** Made the gates testable: the hook test harness, the
  bash-write gate, blueprint Scope-glob hygiene, session-state regeneration. The gates stopped being
  vibes. Detail: EVIDENCE "Phase 0 retro".
- **Phase 1 — Cheapen every session (V2-101…107).** Split the constitution (8KB always-on + lazy
  path-scoped rules), retrieval-on-demand memory, velocity as a gated pillar, parallel-by-default,
  the native-agent-teams verdict (ADR-057 → `/fan-out`), ccusage, permission-friction review. Detail:
  EVIDENCE "Phase 1 retro".
- **Phase 2 — Complete the loop (V2-201…210).** The build loop: `/benchmark` + `/explore` + `/retro`,
  two-stage review (spec-compliance before quality), blueprint parity/app-floor/DAG/amendment gates,
  BDD traceability (ADR-058), the Asset Tracker pilot end-to-end. Detail: EVIDENCE "Phase 2 retro".
- **Phase 3 — Shrink the decision space (V2-301…309).** The design/decision rails: the visual
  iteration loop + taste anchors, the layout/type lint siblings of the token rule, the copy
  chokepoint, the OSS catalog + `/adopt`, visual regression, and build-vs-buy completeness (the
  Considered-line requirement). Detail: EVIDENCE "Phase 3 retro".
- **Phase 4 — Verify what was waived (V2-401…409).** Turned waved-off claims into machine-checked
  ones: testcontainers + the warm/`ship:full` split (ADR-061), pgvector round-trip proof, the
  enforced coverage floor, the cognitive-complexity gate (closing ADR-034's v2 gap), StrykerJS
  mutation testing (which caught real `password.ts` test gaps, 70→82.5%), the middleware §15 unit
  tests, the protect-secrets write-side guard, and dated debt sunsets. The senior review found — and
  we fixed — three real protect-secrets write bypasses (Bash/MultiEdit/over-broad `.env.*`). Detail:
  EVIDENCE "Phase 4 evidence" rows.
- **Phase 5 — Stack & steady state (V2-501…507).** The after-the-program layer: the recorded auth
  decision (ADR-056 re-confirmed STAY FROZEN), Renovate, skill-standard conformance (all 34 skills
  vs agentskills.io, gated in `/ship`) + plugin.json refresh, the context7-backed docs-currency
  skill, the platform-doctrine-sync ADR section + maintainer runbook (the bus-factor floor), the fork
  doc-payload manifest (`rebrand --prune-docs`), and this closeout. Detail: EVIDENCE "Phase 5
  evidence" rows.

## Spend (ccusage)

Per-session (this closing session, `npm run tokens`): **~1.45M output tokens, ~739M total tokens
(mostly cache-read), ≈ $521** across haiku/sonnet/opus (V2-022 model-tier routing). The program ran
across MANY sessions; ccusage is session-scoped, so this is the representative recent figure, not the
aggregate program spend. The cache-read dominance (≈ 98% of total tokens) is the token-thrift
harness (V2-101 constitution split + V2-102 retrieval-on-demand + prompt caching) working as intended.

## The three deltas (then → now)

- **Context tax (`npm run context-tax`).** Always-on SessionStart bytes = **19.31 KB / 20 KB budget**
  (CLAUDE.md 8.00 KB · agent-memory digest 2.71 KB · handoff auto-status 8.61 KB). Before V2-101 the
  constitution was a single large always-on file; the split put the domain detail behind lazy
  path-scoped `.claude/rules/*.md` (loaded only on a matching edit), holding the constitution to 8 KB.
- **Warm `/ship` time.** Baseline `velocityBaselines.shipWarmSeconds` = **90 s**; observed warm runs
  this session ~**66–78 s** despite the loop GROWING (V2-404 cognitive-complexity, V2-403 coverage,
  V2-503 skill-check all added) — the warm loop stayed under budget because the DB/app/docker-
  dependent work moved to `ship:full` (ADR-061), not the warm path.
- **Gate count.** Warm `/ship` went from the Phase-0/1-era core (~21 checks) to **22 warm** now
  (typecheck · lint incl. cognitive-complexity · format · contract/component/hook tests · scalability
  · copy · wave-offs · licenses · tier · blueprint(+content) · complexity · db-structure · knip ·
  duplication · coverage · skill-check · build · size-limit · gitleaks · npm-audit · ai-eval), **plus
  docker + bdd-coverage + integration** in `ship:full`. More coverage, same speed — the point.

## Superseded-items map

The V2 program folded a number of earlier-planned items into stronger mechanisms (from
`HARNESS-V2-BACKLOG.md`):

| Original                  | Superseded by              | Note                                             |
| ------------------------- | -------------------------- | ------------------------------------------------ |
| M2 market-scan check      | V2-202                     | parity disposition is stronger                   |
| M4 drift detection        | V2-206 stage 1             | review-rail placement                            |
| M5 coverage matrix        | V2-207                     | machine-verified by construction                 |
| M10 routing-report gate   | V2-106 note                | reactivates on operator budget                   |
| M14 skill-eval cadence    | V2-503 / R8 note           | official Skill Creator harness when adopted      |
| P3 /fan-out               | V2-105 verdict             | built as the enforced layer over native dispatch |
| P5 utilization metrics    | V2-106                     | ccusage provides                                 |
| caveman compression       | V2-101                     | structural fix > compression                     |
| D6 / D9                   | V2-302 / V2-301 + V2-307   | folded in                                        |
| B3 / B5 / O4              | V2-201 / V2-306 + V2-204   | one research pass                                |
| O3 registry ladder        | V2-302 / V2-306 + /conform | folded in                                        |
| #20 / M12 impl. subagents | V2-105 + V2-205            | mechanism + DAG deliver it                       |

## Open items / deferrals (each carries a register line)

Deliberately NOT done in harness-v2 — deferred with a `docs/findings-register.md` line, not dropped:

- ~~**O5 license gate** (SBOM-based check)~~ → **SHIPPED 2026-07-18** (post-close deferral work):
  `scripts/sbom-license-gate.mjs` + `npm run license:sbom`, wired into `ship:full`; reuses the ADR-051
  deny set + allowlist against the CycloneDX SBOM. `docs/build-vs-buy-ledger.md` (O5).
- ~~**P6 worktree recipe**~~ → **SHIPPED 2026-07-18** (post-close): the `/fan-out` skill gains a
  "Worktree isolation" recipe (native `Agent isolation: "worktree"` + the manual
  `git worktree add`/merge/remove wave), closing the attribution-limit gap the skill names.
- ~~**#17 SECURITY.md size review**~~ → **DONE 2026-07-18** (operator chose "reformat for
  readability"): §11 (threat findings) + §13 (CVE remediations) reformatted from wide single-line
  table cells into a lean index + per-item subsections — **zero content loss** (85/85 cells verified
  verbatim), 104.6 KB → 87.3 KB. §6 (a genuine secrets lookup table) + §2 (prose) left as correct.
- **#22 marketplace publication** → the plugin is publish-READY (V2-503) but the private posture
  holds (ADR-054); publishing is a config flip + a superseding ADR.
- **#27 full bus-factor program** → V2-505 shipped the maintainer-runbook floor; the full program is
  larger.
- **Better Auth MIGRATION** → V2-501 recorded STAY FROZEN; a migration only starts if an ADR-056
  trigger fires, as its own blueprinted program.
- **WS-5 embeddings-provider round-trip** → the pgvector SUBSTRATE is `fixed` (V2-402); the provider
  round-trip stays `waived` until a fork sets `EMBEDDINGS_API_KEY` + egress (operator-adjudicated
  SPLIT, 2026-07-17).
- **uptime / Storybook recipes (#28)** → `docs/oss-catalog.md` catalog entries suffice for now.

## Exit

All 48 items complete, `/ship`-green, senior-reviewed, and landed on `main`. The evidence manifest
(`docs/HARNESS-V2-EVIDENCE.md`) has no empty-evidence rows for non-deferred items. harness-v2 is
**closed**.
