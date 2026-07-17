# Session handoff (current)

<!-- BEGIN:auto-status (rendered by scripts/render-handoff.mjs from docs/session-state.json -- do not hand-edit) -->

## At-a-glance — IN PROGRESS / REMAINING (the fast status read)

_Program: **harness-v2** · branch `claude/harness-v2-kickoff-yhid26` · updated 2026-07-17 · last /ship: **green** (972862a, 2026-07-17)._

| State | Item | Blocked by | Next action |
|-------|------|-----------|-------------|
| ✅ DONE | **H2-P0** harness-v2 Phase 0 — Trust the gates (V2-001..V2-006) | — | COMPLETE + on main. Phase 0 — trust the gates (V2-001..006). |
| ✅ DONE | **H2-P1** harness-v2 Phase 1 — Cheapen every session (V2-101..V2-107) | — | COMPLETE + on main (6c56af3). Phase 1 — cheapen every session (V2-101..107). Retro in EVIDENCE. |
| ✅ DONE | **H2-P2** harness-v2 Phase 2 — Complete the loop (V2-201..V2-210) | — | COMPLETE + on main (f905631). Phase 2 — complete the loop (V2-201..210). Retro in EVIDENCE. |
| ✅ DONE | **H2-P3** harness-v2 Phase 3 — Shrink the decision space (V2-301..V2-309) | — | COMPLETE + on main (45a0500). Phase 3 — shrink the decision space (V2-301..309). Retro in EVIDENCE. |
| ✅ DONE | **H2-P4** harness-v2 Phase 4 — Verify what was waived (V2-401..V2-409) | — | COMPLETE + on main (8fb4737) + senior-reviewed+fixed. Phase 4 — verify what was waived (V2-401..409). WS-5 adjudicated SPLIT. Detail in EVIDENCE. |
| ✅ DONE | **H2-P5** harness-v2 Phase 5 — Stack & steady state (V2-501..V2-507) | — | COMPLETE + senior-reviewed+fixed (4572574, /ship green). Phase 5 — stack & steady state (V2-501..507). Review: 1 High (doc-manifest session-state prune gap) + counts + Scope, all fixed. Ready to land = harness-v2 CLOSED. Detail in EVIDENCE/CLOSEOUT. |

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
| Finalize — Post-close finalization — WS-1 Docker verify+fix, Renovate cutover, doc refresh | [x] | 972862a · 2026-07-17 · WS-1 self-host distroless image built+booted+migrated+served for the FIRST time (a Docker daemon became available); 5 latent defects fixed (2378a91/4d8d111): build-time AUTH_SECRET, public/ dir, prod-pruned node_modules (Prisma 7 CLI closure), prisma.config.ts copy, pgvector smoke DB. findings-register WS-1 = fixed. Renovate app connected + dependabot.yml retired (972862a). Docs finalized: session-state/handoff re-stamped, agent-memory updated, dead scratch removed, superseded docs closed in place. |

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

1. harness-v2 CLOSED + all post-close work landed on main (972862a, /ship green). WS-1 Docker self-host image VERIFIED+FIXED in-session (5 latent defects — build AUTH_SECRET, public/, prod node_modules Prisma-CLI closure, prisma.config.ts copy, pgvector smoke DB); findings-register WS-1 = fixed. Renovate app connected + dependabot.yml retired.
2. 3 deferrals remain, each gated (register lines): WS-5 provider round-trip (needs embeddings key/egress), Better Auth migration (stay-frozen), uptime/Storybook (catalog suffices).
3. TEMPLATE FINALIZED 2026-07-17 — main is the source of truth; no in-flight work. Docs refreshed, dead scratch removed, historical docs closed in place.

<!-- END:auto-status -->

---

# TEMPLATE FINALIZED (2026-07-17)

> The template is finalized: `main` is the single source of truth. Every program is
> complete and landed — the AntD→Tailwind replatform, the enterprise pivot (WS-1..8),
> the code wave, and harness-v2 (Phases 0–5). Post-close, the WS-1 self-host Docker
> image was verified + fixed end-to-end (it had never actually been built), and
> Renovate replaced Dependabot as the dependency bot. Full history: `git log` +
> `docs/HARNESS-V2-CLOSEOUT.md`.

## State

- `main` = branch tip = everything landed. Last `/ship`: **green** (`972862a`, 2026-07-17).
- No work is in flight. Remaining backlog is trigger-gated only (see the deferred list in
  the auto-status block above + `docs/findings-register.md`; 3 gated deferrals remain).
- Durable landmines/gotchas live in `docs/agent-memory.md` (a digest is surfaced at
  SessionStart; retrieve full sections on demand).

## Operator hygiene (optional — a session cannot do these)

- **Stale remote branches.** ~27 old `claude/*` program branches, plus now-orphaned
  `dependabot/*` branches (Dependabot was retired 2026-07-17), still exist on the remote.
  A session cannot delete refs (the git bridge returns 403). Clean them via the GitHub
  Branches UI, or locally with `git push origin --delete <branch>`, leaving `main` (and any
  active working branch). Renovate's first branch (`renovate/minor-and-patch-dependencies`)
  is expected — keep it.
- **Secrets.** If a live Vercel/Neon deployment exists, confirm `AUTH_SECRET` +
  `SEED_ADMIN_PASSWORD` are the deployment's own values, not the seeded defaults
  (SECURITY.md T-10).
