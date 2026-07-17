# Session handoff (current)

<!-- BEGIN:auto-status (rendered by scripts/render-handoff.mjs from docs/session-state.json -- do not hand-edit) -->

## At-a-glance — IN PROGRESS / REMAINING (the fast status read)

_Program: **harness-v2** · branch `claude/harness-v2-kickoff-yhid26` · updated 2026-07-17 · last /ship: **green** (5285a19, 2026-07-17)._

| State | Item | Blocked by | Next action |
|-------|------|-----------|-------------|
| ✅ DONE | **H2-P0** harness-v2 Phase 0 — Trust the gates (V2-001..V2-006) | — | COMPLETE + PUSHED. Now on branch yhid26 (fast-forwarded from 25kqc6). |
| ✅ DONE | **H2-P1** harness-v2 Phase 1 — Cheapen every session (V2-101..V2-107) | — | PHASE 1 COMPLETE (832821c, /ship green), landed on main (6c56af3). ALL 7/7 items done + senior-reviewed + fixed. V2-105 CLOSED: ADR-057 (verdict=CUSTOM), /fan-out skill + scripts/fan-out.mjs; senior review 1 High + 3 Med + 1 Low ALL fixed. Exit criteria met. Retro in HARNESS-V2-EVIDENCE.md. |
| ✅ DONE | **H2-P2** harness-v2 Phase 2 — Complete the loop (V2-201..V2-210) | — | PHASE 2 COMPLETE (5cc2d21, /ship green, pushed), landed on main (f905631). ALL 10/10 items done + pilot two-stage-reviewed + fixed. Loop machinery: /benchmark+/explore+/retro, two-stage review (V2-206), blueprint parity/app-floor/DAG/amendment gate (V2-202/203/205/209), BDD traceability (V2-207/ADR-058 Accepted). Retro in HARNESS-V2-EVIDENCE.md. |
| ✅ DONE | **H2-P3** harness-v2 Phase 3 — Shrink the decision space (V2-301..V2-309) | — | PHASE 3 COMPLETE + LANDED ON MAIN (main @ 45a0500, /ship green, ff from f905631). ALL 9/9 done + THREE senior-review rounds (V2-304 font-size-regex substring bug; V2-305 JSXExpressionContainer bypass; phase-3-close: 3 wrong OSS-catalog AGPL labels + ledger broad-glob hygiene + VR ratio-vs-absolute tolerance — all CONFIRMED, fixed, re-tested). Look: V2-301 visual loop + V2-307 anchors/rubric + V2-302 primitives + V2-303 archetypes + V2-304 no-arbitrary-className + V2-308 visual-regression. Copy: V2-305 no-literal-jsx-text chokepoint + /ship copy gate (22 labels → sentence case). Build-vs-buy: V2-306 oss-catalog + /adopt (ADR-060 demo) + V2-309 gate widened to components/shared+scripts, Considered: + broad-glob hygiene. 13 ESLint rules; tests 13/13 lint-rules + 59/59 hooks (incl 5/5 visual). Retro in HARNESS-V2-EVIDENCE.md. |
| ✅ DONE | **H2-P4** harness-v2 Phase 4 — Verify what was waived (V2-401..V2-409) | — | PHASE 4 COMPLETE (5285a19, /ship + ship:full green) + senior-reviewed + fixed. 9/9 items: V2-401 (@testcontainers/postgresql + ship:full, 6/6 vs native pgvector), V2-402/403 (pgvector + coverage floor), V2-404 (sonarjs cognitive-complexity @error), V2-405 (StrykerJS; caught real password.ts gaps 70->82.5%), V2-406 (routeDecision extraction + §15 tests), V2-407 (osv-scanner+trivy in /audit), V2-408 (protect-secrets write-guard), V2-409 (debt sunset). senior review: 1 Critical + 2 High (protect-secrets Bash/MultiEdit/exemption bypasses) + 1 Stage-1 High (blueprint Scope) ALL FIXED with regression tests (test:hooks 64/64). Ready to land on main. |

## GRAND PROGRESS TABLE (built from docs/session-state.json)

Legend: `[x]` done · `[~]` partial · `[ ]` pending · `[-]` deferred/dropped.

**5 operator directives**

| Item | Status | Commit / note |
|------|--------|---------------|
| D1 — Adopt all 22-table recommendations | [x] | DONE (2026-07-03). 21/22 categories done/deferred; cat 12 stays partial only because lhci per-PR CI is dormant until Actions billing (deferred: lhci-ci). Remaining catalog items = the tracked DEFERRED set (re-promote via /blueprint on trigger). |
| D2 — Docker always built (standard artifact) | [x] | 8b50604 |
| D3 — Replace AntD with Tailwind fully | [x] | c7f3a4c |
| D4 — RTL + Arabic fully optional | [x] | ADR-028 Part 1 + workstream D (2026-07-03): DirectionProvider RTL + dark a11y browser-verified |
| D5 — Every app has a structured DB | [x] | b82c12d |

**Workstreams (Phase0 / C1–C4 / B / E / D / A1–A5)**

| Item | Status | Commit / note |
|------|--------|---------------|
| Replatform — AntD→Tailwind replatform (Phase0, C1–C4, C3.5, B, E, D, A1–A5) | [x] | c7f3a4c · 2026-07-03 · All workstreams complete + browser-verified (light AND dark axe serious/critical clean; body-bg paint 8051d85 killed the dark false-positive flood). Full per-workstream history: git log docs/session-state.json before 2026-07-13. |
| EP — Enterprise pivot P0+P1+P2 (WS-1..8, ADR-035..048) | [x] | 4989347 · 2026-07-12 · All landed on main: WS-1 distroless Docker, WS-2 supply-chain+Argon2id, WS-3 Valkey limiter, WS-4 OTel backbone, WS-5 lib/ai + /scaffold-ai-endpoint + ai-eval gate + AI-Quality pillar + pgvector seam + Langfuse-via-OTel, WS-6 Ory Polis SSO/SCIM (closeout 4989347), WS-7 Node 24 + zod v4 + Prettier gate + React Compiler (ADR-048), WS-8 harness hardening. |
| CW — Code wave items 1–8 (ADR-049..056) | [x] | f9f6c33 · 2026-07-13 · 1 .mcp.json pins · 2 OpenAPI seam (opt-in Scalar enabler) · 3 Fumadocs docs-site enabler · 4 account-free CI/supply-chain slice (zizmor, osv, license gate, --ignore-scripts) · 5 pg-boss queue seam · 7 harness-as-plugin + agent-eval v1 · 8 A.6 verdict table. Item 6 = no action (auth pin done; SheetJS trigger-gated). Batched senior review closed (44ac3e1). Socket/Harden-Runner deferred pending operator accounts. |
| A.6 — frontend-design plugin adoption (top A.6 action) | [x] | 4ad32b5 · 2026-07-13 · Enabled project-wide, ordered AHEAD of /design-system (SKILL.md §0; repo tokens/primitives stay binding). TRIAL VERDICT PENDING on the next real UI build (agent-memory 2026-07-13). |

**22 comparison categories (directive D1 coverage)**

| Cat | Status | Where |
|-----|--------|-------|
| 01 collections | [x] | skill auto-activation (A4) |
| 02 skills | [x] | grill-with-docs + domain-modeling (A4) |
| 03 subagents | [x] | reviewer lenses (A4) + /stack-advisor |
| 04 hooks | [x] | A2 (7 hooks) |
| 05 mcp | [x] | context7 + chrome-devtools-mcp (A3) |
| 06 frameworks | [-] | wasp study -> deferred backlog |
| 07 scalability | [x] | postgres-mcp/k6/pghero (A3); citus deferred |
| 08 maintainability | [x] | knip + jscpd ship gates (A1) |
| 09 quality | [x] | reviewer lenses (A4) + coverage/complexity gates (A1) |
| 10 security | [x] | A2 + trivy + trufflehog |
| 11 speed-of-dev | [-] | wasp CRUD study -> deferred |
| 12 performance | [~] | Speed Insights/analyzer/react-scan/size-limit done; lhci CI dormant |
| 13 code-optimization | [x] | knip + jscpd ship gates (A1) |
| 14 architecture | [x] | MADR schema + Mermaid C4 (A4) |
| 15 benchmarking | [x] | peer/enterprise benchmark in /uat (A3) |
| 16 testing | [x] | coverage floor (A1) + /cover (A5) |
| 17 functional-testing | [x] | GWT + /manual-uat record-to-spec (A5) |
| 18 logical-testing | [x] | fast-check property tests (A5) |
| 19 requirements | [x] | blueprint story IDs + EARS (A4) |
| 20 planning | [x] | Superpowers writing-plans + [P] markers (A4) |
| 21 design | [x] | style-dictionary seed + Figma sub-recipe (A5) |
| 22 uiux | [x] | jsx-a11y gate (A1) + slop-gate + WCAG 2.2 AA criteria (A5) |

**Deferred (tracked, not scheduled — see the program blueprint's closeout TODO)**

- `tremor` — Tremor charts — trigger: @tremor/react peer accepts React 19
- `lhci-ci` — Lighthouse-CI per-PR assertion — trigger: /handoff to a team with Actions billing
- `claude-task-master` — claude-task-master — trigger: fork outgrows single-session planning
- `backlog-md` — Backlog.md — trigger: same as claude-task-master
- `fastmcp` — fastmcp provider path — trigger: we ship our own MCP server
- `keploy` — keploy record-replay — trigger: API-level test-gen alternative
- `vitest` — Vitest migration — trigger: test-runner swap; needs its own ADR
- `citus` — citus / read-replicas — trigger: scale trigger (cat 07)
- `sonarqube-mcp` — sonarqube-mcp at /handoff — trigger: IT team runs SonarQube
- `wasp` — wasp declarative-CRUD ergonomics study — trigger: over /scaffold-entity (cat 11)
- `socket-harden-runner` — Socket + Harden-Runner CI slices (ADR-050/051) — trigger: operator creates the accounts
- `sheetjs` — exceljs -> SheetJS swap (ADR-051) — trigger: exceljs CVE or a new export feature

**Next actions**

1. Phase 4 COMPLETE + landed on main (8fb4737). WS-5 pgvector wave-off ADJUDICATED by operator (SPLIT: substrate fixed, provider round-trip waived).
2. START Phase 5 (final harness-v2 phase): re-read the program doc for the Phase-5 item list; /blueprint (full track) first, then execute item-by-item (ship-green + push each), senior review at close, land on main.
3. Provider RAG round-trip (WS-5 half) stays waived until a fork sets EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY with egress.

<!-- END:auto-status -->

---

# CURRENT STATE (2026-07-13) — programs complete; repo hygiene is the only open item

> This handoff was collapsed on 2026-07-13: the replatform program, the enterprise
> pivot (WS-1..8), and the code wave (items 1–8) are ALL COMPLETE and on `main`.
> The full session-by-session history lives in git
> (`git log --follow docs/SESSION-HANDOFF.md`, sections before 2026-07-13).

## State

- `main` = branch tip = everything landed. Last `/ship`: **green** (19 phases) on 2026-07-13.
- Senior-review batch over code-wave items 4/5/7: retrieved + both findings fixed (`44ac3e1`).
- A.6 P1 frontend-design plugin: adopted (`4ad32b5`), ordered ahead of `/design-system`.
  **Trial verdict pending** — use it on the next real UI build, record the verdict in
  agent-memory + `docs/research/a6-tool-shortlist-verdicts.md` (fallback: `impeccable`).
- No work is in flight. Remaining backlog is trigger-gated only (see the deferred list
  in the auto-status block + `docs/deferred-adoption-plan.md`).

## OPERATOR ACTION — delete the 18 stale remote branches

Sessions cannot do this: the git bridge returns HTTP 403 on ref-deletion (re-verified
2026-07-13) and the GitHub MCP has no delete-branch tool. Run locally (or use the
GitHub Branches UI). Adjudication (2026-07-13, per-branch `merge-base` + unique-commit
inspection):

**Fully merged into main (8) — zero unique commits:**

```sh
git push origin --delete \
  claude/enterprise-pivot-research-6t7euo \
  claude/enterprise-pivot-research-ai8st1 \
  claude/enterprise-pivot-research-kiaozb \
  claude/enterprise-pivot-research-pfzaho \
  claude/enterprise-ws-6-identity-r5jo7s \
  claude/enterprise-ws-7-stack-bumps \
  claude/go-6wma0m \
  claude/next-patch-bump-main-1i0qvr
```

**Superseded doc-scratch only (6) — unique commits are handoff/REPO-MAP regens or
code that was verified already landed on main (next 16.2.10 ✓, React Compiler +
`react-hooks/incompatible-library` at error ✓, WS-8 /remember content ✓):**

```sh
git push origin --delete \
  claude/enterprise-pivot-p2-3ws7rj \
  claude/enterprise-ws-6-closeout-lh3me8 \
  claude/enterprise-ws-8-harness \
  claude/formfield-zod-v4-tests-2pv2ho \
  claude/go-h3f21f \
  claude/go-vshxj1
```

**Dead pre-replatform history (4) — no common ancestor with main (`merge-base` empty);
their useful content was re-derived on the new history (complexity gate ADR-034,
watchdog tuning, enterprise research v2, MCP wiring — all on main):**

```sh
git push origin --delete \
  claude/claudecodeui-review-dwljgu \
  claude/enterprise-pivot-research-cqdgsw \
  claude/template-repo-integration-hi4598 \
  claude/watchdog-session-context-waktf8
```

After this session's branch (`claude/git-integration-dlg383`) is merged/confirmed on
main, delete it too — leaving only `main`.

## Notes for the next session

- Landmines are in `docs/agent-memory.md` (gitleaks reinstall via the Go proxy; run
  `/ship` WITHOUT `NODE_ENV=production`; `make browser-up` before any real-site
  browser work; AskUserQuestion "permission stream closed" → retry once).
- Optional prod-DB hygiene: the axe-probe admin (`axe-probe@example.com`) from the
  2026-07-03 dark-axe run still exists in the prod DB (soft-delete via user
  management if unwanted); `SEED_ADMIN_PASSWORD` env still holds the probe value —
  `admin@example.com` login is unaffected.
