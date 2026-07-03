# Deferred-adoption plan (the 11 tracked-not-scheduled items)

The replatform-and-adoption program is at terminal state: every **scheduled**
directive (D1–D5) and workstream (Phase0, C1–C4, B, E, D, A1–A5) is done, merged
to `main`, `/ship` green. What remains is the **tracked-deferred set** — 11 items
that were consciously *not* scheduled, each gated behind a **trigger** that has not
yet fired. Source of truth for live status: `docs/session-state.json` `deferred[]`
and `docs/deep-comparison/ADOPT.md`. This doc is the forward-looking **plan**: for
each item, the trigger, the adopt path, the drop alternative, and the effort — so
when a trigger fires the item re-enters via `/blueprint` from a decision, not a
cold start.

**Binding rule (from the program blueprint's closeout gate, line 211):** none of
these may be adopted *silently*. Each re-promotion is a `/blueprint` pass (full
track for anything touching `lib/`, deps, or CI; lightweight otherwise), and the
outcome is recorded as an ADR line or a `docs/findings-register.md` `dropped`
entry. A row kept unbuilt is a *decision to drop* (logged), not an oversight.

Legend for **Disposition**: `WATCH` = wait for trigger, then adopt · `WATCH/DROP`
= re-evaluate adopt-vs-drop when trigger fires · `ON-HANDOFF` = decide at `/handoff`.

---

## 1. tremor — Tremor-style charts
- **What:** `@tremor/react` chart components (Tremor-style API). The program built
  charting on **recharts `^2.15.4`** with a Tremor-style wrapper API instead.
- **Why deferred:** `@tremor/react@3.18.7` pins a hard `react@^18` peer; this repo
  is on `react@^19.2.5` (C2, 2026-07-03).
- **Trigger:** `@tremor/react` publishes a release whose peer accepts React 19.
- **Disposition:** **WATCH/DROP.** When the peer clears, decide: adopt as a drop-in
  behind the existing chart API, **or** permanently keep recharts and close Tremor.
- **Adopt path:** `npm i @tremor/react` → confirm peer resolves clean → migrate the
  chart-palette consumers to Tremor primitives behind the current wrapper (no
  call-site churn) → `/design-qa` axe pass (charts are an a11y-sensitive surface).
- **Drop path:** record "recharts is permanent, Tremor closed" as an **ADR-029
  amendment** + a `dropped` findings-register line.
- **Effort:** S (drop) / M (adopt, ~1 session). **Gate:** `Ask before` (runtime dep
  > 50 KB → needs the ADR/scale-up path).

## 2. lhci-ci — Lighthouse-CI per-PR assertion
- **What:** Per-PR Lighthouse performance/a11y/SEO assertion in CI.
- **Already shipped:** `lighthouserc.cjs` config + `npm run lhci` script — runnable
  ad-hoc today. Only the **CI gate** is dormant.
- **Why deferred:** CI workflows are dormant on the free plan (no Actions billing);
  a per-PR gate needs Actions minutes.
- **Trigger:** `/handoff` to a team with Actions billing (the same event that
  activates the dormant `senior-review.yml` / security workflows).
- **Disposition:** **ON-HANDOFF.**
- **Adopt path:** add an `lhci` job to CI wired to `lighthouserc.cjs`, set the
  assertion budget, gate PRs. **Drop path:** keep `npm run lhci` as ad-hoc-only and
  note it in the handoff package.
- **Effort:** S (~½ session, config exists). **Gate:** CI activation (`/handoff`).

## 3. claude-task-master — multi-session task orchestration
- **What:** External task-master tooling for planning across many sessions.
- **Why deferred:** The template's native rail (`/blueprint` + `docs/session-state.json`
  + `SESSION-HANDOFF.md` + the render-handoff status tables) covers single-session
  and short multi-session planning. Adopting an external planner now is premature.
- **Trigger:** a fork outgrows single-session planning (sustained multi-week backlog
  the native handoff docs can't hold).
- **Disposition:** **WATCH/DROP.** Concept-over-dependency bias (ADR-022): prefer
  extending the native rail unless the external tool clearly wins.
- **Adopt path:** `/blueprint` a spike comparing it against the native rail; adopt
  only the delta that the native docs can't express. **Effort:** M.

## 4. backlog-md — Markdown backlog tool
- **What:** `Backlog.md`-style committed-Markdown backlog management.
- **Why deferred:** Same space as #3; native `session-state.json` + blueprints
  already carry the backlog.
- **Trigger:** same as claude-task-master (fork outgrows single-session planning).
- **Disposition:** **WATCH/DROP.** Evaluate #3 and #4 together — pick at most one.
- **Effort:** S–M.

## 5. fastmcp — MCP server framework
- **What:** `fastmcp` provider path for authoring an MCP server.
- **Why deferred:** The template **consumes** MCP servers (context7, github,
  playwright, figma) but does not **ship** one.
- **Trigger:** we decide to ship our own MCP server (e.g. exposing the template's
  scaffold/ship/deploy skills as MCP tools for external agents).
- **Disposition:** **WATCH.** Adopt-when-needed; no drop decision required (it's a
  build-enabler, not a competing choice).
- **Adopt path:** `/blueprint` the server surface first, then `fastmcp` (or the
  official MCP SDK — compare at that point). **Effort:** M–L.

## 6. keploy — record-replay API test generation
- **What:** `keploy` captures real API traffic and replays it as generated tests.
- **Why deferred:** The repo's test rail is the node:test contract suite + `/cover`
  AI test-gen + Playwright UAT + fast-check property tests — API-level record-replay
  is an *alternative*, not a gap.
- **Trigger:** we want an API-level test-gen alternative (contract suite proves
  insufficient for a data-heavy route surface).
- **Disposition:** **WATCH/DROP.** Likely DROP unless a concrete API-coverage gap
  appears — the current rail is comprehensive.
- **Effort:** M. **Gate:** `Ask before` (new tooling + it observes real traffic —
  data-handling review).

## 7. vitest — test-runner migration
- **What:** Migrate the test runner from `node:test` to Vitest.
- **Why deferred:** `node:test` is the shipped runner (`/cover`, contract suite,
  property tests all target it). A runner swap is a large, cross-cutting change with
  no current pain.
- **Trigger:** a decision to swap runners (watch-mode DX, richer matchers, or a
  library that assumes Vitest).
- **Disposition:** **WATCH/DROP — needs its own ADR.** This is a stack change; per
  CLAUDE.md a superseding ADR must precede it (ADR-001 locked-stack discipline).
- **Adopt path:** ADR first → `/blueprint` full track → migrate specs + `/ship`
  gate wiring + `/cover` retarget. **Effort:** L.

## 8. citus — Postgres sharding / read-replicas
- **What:** `citus` (or Neon read-replicas) for horizontal DB scale.
- **Why deferred:** Comparison cat 07 (scalability) is covered by
  postgres-mcp/k6/pghero; sharding is unwarranted at prototype scale.
- **Trigger:** the cat-07 **scale trigger** — single-primary Postgres becomes the
  bottleneck (sustained read load, dataset outgrows one node).
- **Disposition:** **WATCH.** Prefer the lighter `/scale-up` rung first (Neon Launch
  PITR → read-replicas → Upstash for rate-limit) before citus sharding.
- **Adopt path:** via `/scale-up` (cat 07 recipe) + ADR. **Effort:** L. **Gate:**
  `Ask before` (infra change).

## 9. sonarqube-mcp — SonarQube integration
- **What:** `sonarqube-mcp` to surface SonarQube findings to the agent.
- **Why deferred:** Static-analysis is covered natively (the 10 ESLint rules,
  knip, jscpd, complexity + coverage gates, Semgrep in `/audit`). SonarQube is an
  IT-team tool, not a solo-operator one.
- **Trigger:** `/handoff` to an IT team that runs SonarQube.
- **Disposition:** **ON-HANDOFF.** Wire only if the receiving team already uses it.
- **Effort:** S (integration only). 

## 10. wasp — declarative-CRUD ergonomics study
- **What:** Study `wasp`'s declarative CRUD DSL for ergonomics ideas.
- **Why deferred:** This is a **study**, not an adoption — wasp is a different
  framework (violates the ADR-001 locked stack). Comparison cats 06 (frameworks)
  and 11 (speed-of-dev) are marked `[-]` deferred for this reason.
- **Trigger:** a `/scaffold-entity` ergonomics pass (cat 11) where we want to mine
  wasp's DSL for improvements to *our* scaffolder.
- **Disposition:** **WATCH/DROP — study only, never a dependency.** Any output is an
  improvement to `scripts/scaffold-entity.mjs`, not a wasp adoption.
- **Effort:** S (study). 

## 11. specialist-agents — stack-aware review agent seeds
- **What:** Specialist subagent seeds (`nextjs-pro` / `postgres-pro` /
  `prisma-expert`) as one optional stack-aware review agent (cat 03).
- **Why deferred:** The review rail (native `/code-review` diff gate +
  `senior-code-reviewer` breadth pass + the A4 reviewer lenses) covers the ground;
  a specialist agent is additive polish.
- **Trigger:** we want one optional stack-aware review agent layered on the existing
  reviewers.
- **Disposition:** **WATCH.** Adopt as a single composed `.claude/agents/*` seed, not
  a fleet; must not duplicate the existing reviewer lenses.
- **Effort:** S–M. 

---

## Summary matrix

| # | Item | Trigger | Disposition | Effort | Ask-before? |
|---|------|---------|-------------|--------|-------------|
| 1 | tremor | peer accepts React 19 | WATCH/DROP | S–M | yes (dep) |
| 2 | lhci-ci | `/handoff` + Actions billing | ON-HANDOFF | S | CI |
| 3 | claude-task-master | fork outgrows 1-session planning | WATCH/DROP | M | no |
| 4 | backlog-md | same as #3 (pick ≤1 of 3/4) | WATCH/DROP | S–M | no |
| 5 | fastmcp | we ship an MCP server | WATCH | M–L | no |
| 6 | keploy | want API-level test-gen | WATCH/DROP | M | yes (tooling) |
| 7 | vitest | runner swap | WATCH/DROP (ADR first) | L | ADR |
| 8 | citus | cat-07 scale trigger | WATCH | L | yes (infra) |
| 9 | sonarqube-mcp | `/handoff` to SonarQube team | ON-HANDOFF | S | no |
| 10 | wasp | `/scaffold-entity` ergonomics pass | WATCH/DROP (study) | S | no |
| 11 | specialist-agents | want 1 stack-aware reviewer | WATCH | S–M | no |

**None are actionable today** — no trigger has fired. Nearest-term candidates are
the two `/handoff`-gated items (#2 lhci-ci, #9 sonarqube-mcp), which activate the
moment the fork is handed to a team with CI. When any trigger fires, re-promote that
single row via `/blueprint` and record the adopt/drop verdict as an ADR line or a
`findings-register` `dropped` entry — closing the program blueprint's closeout gate
one row at a time.
