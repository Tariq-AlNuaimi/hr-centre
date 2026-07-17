# Session handoff (current)

<!-- BEGIN:auto-status (rendered by scripts/render-handoff.mjs from docs/session-state.json -- do not hand-edit) -->

## At-a-glance — IN PROGRESS / REMAINING (the fast status read)

_Program: **harness-v2** · branch `claude/harness-v2-kickoff-yhid26` · updated 2026-07-17 · last /ship: **green** (5cc2d21, 2026-07-17)._

| State | Item | Blocked by | Next action |
|-------|------|-----------|-------------|
| ✅ DONE | **H2-P0** harness-v2 Phase 0 — Trust the gates (V2-001..V2-006) | — | COMPLETE + PUSHED. Now on branch yhid26 (fast-forwarded from 25kqc6). |
| ✅ DONE | **H2-P1** harness-v2 Phase 1 — Cheapen every session (V2-101..V2-107) | — | PHASE 1 COMPLETE (832821c, /ship green), landed on main (6c56af3). ALL 7/7 items done + senior-reviewed + fixed. V2-105 CLOSED: ADR-057 (verdict=CUSTOM), /fan-out skill + scripts/fan-out.mjs; senior review 1 High + 3 Med + 1 Low ALL fixed. Exit criteria met. Retro in HARNESS-V2-EVIDENCE.md. |
| ✅ DONE | **H2-P2** harness-v2 Phase 2 — Complete the loop (V2-201..V2-210) | — | PHASE 2 COMPLETE (5cc2d21, /ship green, pushed). ALL 10/10 items done + the pilot two-stage-reviewed + fixed. Loop machinery: /benchmark+/explore+/retro (built as a real /fan-out parallel wave — check-overlap+verify-scope clean, live V2-104/105/205 evidence), two-stage review (V2-206), blueprint parity/app-floor/DAG/amendment + /ship blueprint-content gate (V2-202/203/205/209), BDD traceability (V2-207). PILOT V2-210: Asset Tracker ran the WHOLE loop; senior review found 1 High + 2 Med + 1 Low, ALL fixed. Exit criterion met (loop end-to-end; story→test machine-verified by bdd-coverage — delete-a-step-def reds). OPERATOR ASKS pending: ADR-058 (playwright-bdd runtime adoption + enforced --full flip) sign-off — the bdd-coverage checker ships now; the executor install awaits sign-off + V2-401. NEXT: Phase 3 — Shrink the decision space (V2-301 visual iteration loop = highest design priority; V2-302 layout primitives; V2-303 page archetypes; V2-306 /adopt + oss-catalog; V2-307 taste anchors ASK). |

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

1. PHASE 3 IN PROGRESS. ASKs answered: taste anchors=Linear/Vercel/Stripe+operator adds; captures=real env; adopt BOTH V2-304 tailwind-lint + V2-308 visual-regression. Env unblocked (native Postgres recipe in agent-memory 2026-07-17). DONE V2-301 visual iteration loop (5a3e23f): scripts/capture-screens.mjs + rule in .claude/rules/design.md + /design-qa during-build mode; real before/after on the Asset Tracker (caught raw-enum copy defect → humanized labels). REMAINING (8): V2-307 design-references+scored design-qa, V2-302 layout primitives, V2-303 archetypes+demo route, V2-304 tailwind-lint@error, V2-305 copy lint, V2-306 oss-catalog+/adopt, V2-308 visual regression, V2-309 build-vs-buy surface. Phases 1+2 on main (f905631); Phase 3 not yet landed.
2. Per-session landmine: gitleaks NOT preinstalled + release egress-blocked — reinstall via `GOBIN=$HOME/.local/bin GOTOOLCHAIN=auto go install github.com/zricethezav/gitleaks/v8@latest`, add ~/.local/bin to PATH before /ship. Run /ship WITHOUT NODE_ENV=production.
3. Do NOT weaken any Phase 0/V2-101 gate to make a later change pass (KICKOFF §2.10). The context-tax --strict budget (8KB constitution / 20KB total) is now a hook-suite test — keep it green.

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
