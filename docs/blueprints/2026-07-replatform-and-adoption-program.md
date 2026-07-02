# Program blueprint — ecosystem adoption + replatform (5 operator directives)

**Status:** SIGNED OFF (operator, 2026-07-02 — all four open questions answered; see §Open questions)
**Date:** 2026-07-02
**Owner:** Tariq Al-Naaimi
**Source:** operator directives on the deep-comparison batch (`docs/deep-comparison/01–22` + README)

The five directives, restated as scoped goals:

| # | Directive | Reality check | Verdict |
|---|-----------|---------------|---------|
| D1 | Adopt all recommendations across the 22 comparison tables | ~45 distinct items after dedup; a program, not a task | Plan in waves (Workstream A) |
| D2 | Docker is always built — a standard, mandatory part of the stack | Today opt-in (ADR-023, `DOCKER_BUILD=1` gate) | Supersede ADR-023 (Workstream B) |
| D3 | Replace AntD with Tailwind, fully | **Reverses ADR-027** ("keep AntD, do NOT swap", 2026-06-25) and discards ADR-028 Part 2's AntD token system | Needs superseding ADR + explicit re-confirmation (Workstream C) |
| D4 | RTL + Arabic fully optional | **Already shipped** — ADR-028 Part 1: config flag, default `["en"]`, code inert | Verify + optional deepening only (Workstream D) |
| D5 | Every app has a DB with a structured schema | Already core (Prisma+Postgres+Neon, scaffold, migrations) | Formalize as a `/ship` gate (Workstream E) |

---

## Phase 0 — Governance (do first; nothing ships before these ADRs are signed)

Three superseding ADRs, each a one-session write + sign-off:

1. **ADR-029 — UI replatform: AntD 6 → Tailwind v4 + shadcn/ui** (supersedes ADR-027 Part 1 and
   ADR-028 Part 2's AntD-specific layers; amends ADR-001's UI line).
   - Must record: *why the 7-day-old "keep AntD" decision is reversed* (operator directive), what
     survives (brand.config concept, `components/shared/*` API surface, design-recipes patterns,
     `/design-system`+`/design-qa` methodology, tokens-as-single-source), what is discarded
     (`antd-theme.ts`, AntD component-token phases), and the migration triggers table from ADR-027
     as the formal basis.
   - Target stack (per ADR-027's own head-to-head, where shadcn/ui was the recommended swap;
     **Tremor added at operator sign-off 2026-07-02** for charts/KPI/dashboard surfaces):
     **Tailwind v4 (CSS-first `@theme`) + shadcn/ui (Radix primitives) + Tremor (dashboards;
     wraps recharts) + react-hook-form** (forms; zod already at every boundary) + **recharts
     stays** (chart engine under Tremor) + **dnd-kit stays** (kanban).
   - Side benefit to record: removes AntD's CSS-in-JS → the CSP `'unsafe-inline'` style exception
     (ADR-001 consequence) can finally be dropped.
2. **ADR-030 — Docker as a standard build artifact** (supersedes ADR-023's opt-in stance).
   - Vercel+Neon remains the *deploy* default; Docker becomes a *mandatory build gate + handoff
     artifact*, not the deploy path.
3. **ADR-031 — Mandatory structured DB** (formalizes D5; small).

Also in Phase 0: commit `docs/deep-comparison/ADOPT.md` — the deduped D1 backlog (the wave tables
below), so adoption survives sessions and is checkable-off.

---

## Workstream C — AntD → Tailwind replatform (FIRST major build; everything else layers on it)

Sequenced first because it reshapes Workstream A (several adoption items are AntD-phrased, and the
22 tables' "skip: shadcn/Tailwind ecosystem" verdicts **flip to adoptable** once this lands).

**C1. Foundation (1 session).** Install `tailwindcss@4` + `@tailwindcss/postcss`; port
`app/tokens.css` + `brand.config.ts` values into a single `@theme` block (brand.config stays the
white-label source, now emitting CSS variables Tailwind consumes). Wire `next/font` Inter var into
the theme. Keep dark mode as a `[data-theme]`/class strategy matching the current toggle.

**C2. Primitive layer (2–3 sessions).** Rebuild `components/shared/*` on shadcn/ui with the SAME
prop APIs (page header, table, form field, filter bar, modal, state-triad empty/loading/error,
buttons, tags/badges). Same-API rebuild is the blast-radius containment: screens keep compiling
while internals swap. Data table = shadcn Table + TanStack Table (sorting/pagination parity with
AntD Table is the hardest single item — budget it explicitly).

**C3. Screen migration (3–5 sessions).** Sweep `app/[locale]/**` screen by screen: dashboard,
entity CRUD pages, settings/RBAC, auth screens, recycling bin. Forms: AntD `Form` →
react-hook-form + zodResolver (validation messages already zod-shaped). Run `/design-qa` per
screen; axe-clean serious/critical is the per-screen exit bar.

**C4. Harness & guard updates (1–2 sessions).**
- `eslint-rules/no-raw-hex-color`: retarget — token source becomes the `@theme` block; forbid
  arbitrary-value colors (`bg-[#…]`) outside it.
- Rewrite `docs/design-recipes.md` patterns as Tailwind/shadcn markup; update `/design-system`,
  `/design-qa`, the slop gate, `docs/uat-rubric.md` references.
- RTL: replace any physical CSS with Tailwind **logical utilities** (`ms-*`/`me-*`/`start-*`) —
  keeps D4's config-driven RTL working with zero AntD `ConfigProvider direction` dependency.
- Remove `antd`, `@ant-design/*` deps; drop the CSP `'unsafe-inline'` style exception; `/ship`
  green; full `/qa`; dark + (flag-enabled) RTL hold.

**Strategy: big-bang on a branch, not incremental.** This is a template, not a live product — no
fork is forced to migrate until it runs `/sync-from-template`. Land only when `/ship` + `/qa` are
green end-to-end. Total: **7–11 sessions**, the program's dominant cost.

**Consequences to accept in ADR-029:** ADR-028 Phases 0–4 AntD token work is sunk cost (concepts
survive, code doesn't); `docs/deep-comparison/21–22` skip-verdicts get a dated addendum noting the
flip (shadcn/ui, tweakcn, shadcn MCP servers become in-scope; AntD-specific borrows like
`VISUAL_DENSITY → componentSize` re-target Tailwind density tokens).

---

## Workstream B — Docker standard (after C1, parallel with C2+)

1. **Keep `DOCKER_BUILD=1` in `next.config.ts`** (standalone output stays env-scoped so the Vercel
   build is untouched — ADR-023's one true constraint), but make the *gate* unconditional:
2. `/ship` gains a **phase: `make docker-build` must succeed** (image builds from the current
   tree). On slow local machines: cache-friendly multi-stage build; CI runs it always once Actions
   activate. Escape hatch: `"dockerAck"` in `project.config.json` logged to the findings register —
   consistent with the ADR-025 escape pattern, never silent.
3. **trivy image + config scan** (adoption item, cat 10) wired into `/audit` and the docker `/ship`
   phase — a standard artifact must be a scanned artifact.
4. `/quickstart`, `/new-project`, `/handoff` all produce/verify the image; `HANDOFF.md` documents
   `make docker-up` as the IT-team run path. `docker-compose.yml` (app+Postgres) becomes the
   canonical local full-stack, aligning with D5.
5. Update CLAUDE.md "Known traps" (Docker is no longer opt-in) + `docs/token-policy.md` if the
   gate's cost needs a thrift note. **2–3 sessions.**

## Workstream D — RTL/Arabic optionality (verify only — already shipped)

ADR-028 Part 1 delivered exactly D4: `project.config.json` `locales` drives routing, `<html dir>`,
prefix regex, switcher; default `["en"]`; `ar` + RTL code inert until enabled. Remaining work:
1. One verification pass: fresh default fork shows zero RTL/ar surface; flipping
   `["en","ar"]` restores it (UAT already config-driven). **0.5 session.**
2. Optional deepening (operator call, default NO): physically strip `messages/ar.json`/RTL code at
   `/rebrand` time for forks that will never localize. Recommend keeping ADR-028's inert-not-deleted
   stance — reversible beats smaller.
3. C4's logical-properties sweep is the only real new RTL work (owned by Workstream C).

## Workstream E — Mandatory structured DB (small formalization)

Already true by construction (Prisma schema is the source of truth; Neon provisioned by
`/deploy`/`/new-project`; migrations run every Vercel build). Make it a gate:
1. `/ship` check: `prisma/schema.prisma` has ≥1 domain model beyond the auth/audit baseline, and
   `prisma/migrations/` is non-empty and in sync (`prisma migrate diff` clean). Fails red otherwise.
2. `/quickstart` refuses to scaffold a "no-DB" app: every idea passes through `/scaffold-entity`
   (already the flow — this pins it).
3. `/blueprint` full track requires the data-model sketch section to be non-empty before sign-off.
4. ADR-031 records it. **1 session, mostly in `scripts/ship.mjs`.**

---

## Workstream A — the 22-table adoption backlog (deduped → 5 waves)

~45 items dedupe to the waves below. Rule: each wave lands via its own `/blueprint` +
`/ship`-green push; Ask-before items (hooks, `lib/`, eslint-rules) get the full track.

**Wave A1 — deterministic `/ship` gates (highest leverage; after C lands, 2–3 sessions):**
knip (dead code, cats 08/13) · jscpd threshold (08/13) · coverage floor (09/16) · size-limit
bundle budget (12) · eslint-plugin-jsx-a11y (22) · complexity metric (09) · E-gate (schema) ·
B-gate (docker). One consolidated `scripts/ship.mjs` extension + findings-register waiver wiring.

**Wave A2 — security & trust boundaries (2 sessions; Ask-before, full blueprints):**
lasso PostToolUse prompt-injection scanner (04) · karanb192 PreToolUse protect-secrets deny (04) ·
disler dangerous-command deny (04) · mintmcp agent-read secret hook (10) · trufflehog
`--only-verified` in `/audit` (10) · trivy (10, owned by B) · PreCompact context-refresh hook (04).

**Wave A3 — measurement & runtime verification (2 sessions):**
Vercel Speed Insights + Lighthouse-CI vs preview URL (12) · @next/bundle-analyzer flag (12) ·
react-scan dev overlay (12) · context7 MCP (05) · postgres-mcp + k6/k6-mcp + pghero as `/scale-up`
recipes (07) · chrome-devtools-mcp as-needed (05/12).

**Wave A4 — process/skills upgrades (2–3 sessions; mostly markdown):**
blueprint story IDs + EARS criteria + OpenSpec `was→now` delta (19) · Superpowers `writing-plans`
wiring + spec-kit `[P]` markers (20) · anti-rationalization tables on gate skills (02) ·
grill-with-docs + `/domain-modeling` (02) · MADR schema in ADR-TEMPLATE + Mermaid C4 in
`/blueprint` (14) · reviewer lenses + logic-lens trace + confidence filter (09) · skill
auto-activation `skill-rules.json` (01) · plugin-eval for our skills/agents (06) · GWT scenario
shape (17).

**Wave A5 — testing & design depth (2–3 sessions):**
fast-check property tests for scrub/zod invariants (18) · qodo-cover-style AI test-gen on changed
files (16) · `/manual-uat` record-to-spec `*.uat.ts` (17) · token-thrift trimmed Playwright
responses (17) · Figma design-to-code sub-recipe (21 — now targeting Tailwind tokens) ·
style-dictionary `tokens.json` → `@theme` compile (21) · slop-gate named anchors + taste tables +
density knob re-targeted to Tailwind (22) · a11y manual-criteria into `/design-qa` (22) ·
superdesign variants step (21).

**Deferred/Future (tracked in ADOPT.md, not scheduled):** claude-task-master · Backlog.md ·
fastmcp provider path · keploy · Vitest migration · citus/read-replicas · sonarqube-mcp at
handoff · wasp CRUD ergonomics study (11) · specialist-agent seeds (03).

---

## Sequencing & budget

```
Phase 0  ADRs 029/030/031 + ADOPT.md      1–2 sessions   ← sign-off gate
C        AntD → Tailwind replatform       7–11 sessions  ← critical path
B        Docker standard                  2–3 sessions   (parallel from C2)
E        DB gate                          1 session      (parallel, anytime)
D        RTL verify                       0.5 session    (parallel, anytime)
A1–A5    Adoption waves                   9–12 sessions  (A1 after C; A2/A4 anytime)
                                          ─────────────
                                          ~20–29 sessions total
```

Per CLAUDE.md, each session ends pushed; each wave/workstream sub-feature gets its own branch off
`main`, `/ship` green, `/code-review` on Ask-before surfaces, senior-review after push.

## Risks

1. **C is a taste + parity risk, not just a port** — AntD Table/Form are deep; TanStack-based
   parity is the long pole. Mitigation: same-API shared primitives, per-screen `/design-qa` exit.
2. **Reversal churn** — ADR-027 was signed 7 days ago the other way. Mitigation: ADR-029 records
   the reversal rationale so it isn't relitigated a third time; migration-triggers table cited.
3. **Docker gate cost** — image build in `/ship` slows the loop. Mitigation: layer caching, ack
   escape, CI ownership once Actions activate.
4. **Adoption sprawl** — 45 items invite drift. Mitigation: ADOPT.md is the single checklist;
   waves land whole or the remainder is re-logged, never silently dropped (pillar rule).

## Open questions — ALL ANSWERED (operator, 2026-07-02)

1. **C-scope:** ✅ **shadcn/ui + Tremor** — signed off against the 6-screenshot side-by-side
   (ours-AntD, shadcn/ui, Tremor, HeroUI, Catalyst, TailAdmin). Recorded in ADR-029.
2. **B-strictness:** ✅ **`/ship --full` + CI + `/deploy` + `/handoff`** — the fast local `/ship`
   loop stays image-free. Recorded in ADR-030.
3. **D-depth:** ✅ **Keep ar/RTL inert-in-repo** (ADR-028 stance); no strip option at `/rebrand`.
4. **A-priority:** ✅ **A2 + A4 start now; A1 after C lands.** Recorded in ADOPT.md's sequencing
   rules.
