# ADR-029 — UI replatform: Ant Design 6 → Tailwind v4 + shadcn/ui + Tremor

**Status:** Accepted (operator sign-off 2026-07-02)
**Date:** 2026-07-02
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** ADR-027 Part 1 (the 2026-06-25 "keep AntD, elevate at the token
level" decision) and ADR-028 Part 2's AntD-specific layers (`antd-theme.ts`,
per-component AntD token overrides). **Amends** ADR-001's UI line
(`UI: Ant Design 6` → `UI: Tailwind v4 + shadcn/ui + Tremor`).
ADR-027 Part 2 (standard app skeleton) and ADR-028 Part 1 (optional Arabic/RTL)
are **unaffected** and remain in force.

## Context

Seven days ago ADR-027 recorded an explicit operator decision to **keep AntD**
and invest in token-level elevation instead of a library swap; ADR-028 Part 2
then built the enterprise design system (brand contract, component-token depth,
product chrome, branded HOCs) on that basis. On 2026-07-02, reviewing the
deep-comparison batch (`docs/deep-comparison/01–22`), the operator issued a new
directive: **"Replace AntD with Tailwind, fully"** (directive D3 of the
replatform-and-adoption program, `docs/blueprints/2026-07-replatform-and-adoption-program.md`).

This ADR exists precisely so the reversal is recorded once and not relitigated a
third time:

- **Why the reversal.** Operator directive, informed by the deep-comparison
  evidence (categories 21–22: the Tailwind/shadcn ecosystem is where the design
  tooling, theming seams, and a11y depth now concentrate) and by a side-by-side
  visual pass — six dashboard screenshots (our AntD app live, shadcn/ui, Tremor,
  HeroUI, Catalyst, TailAdmin) delivered 2026-07-02, on which the operator
  signed off **shadcn/ui + Tremor** as the component layer.
- **The technical basis was already on file.** ADR-027's own head-to-head ranked
  **shadcn/ui as the recommended swap** (most modern aesthetic, best-in-class
  RSC fit, Radix-grade a11y, native RTL, MIT copy-in with no lock-in, and a
  path to drop the CSP `'unsafe-inline'` style exception). ADR-027's migration
  triggers said "revisit if the question is reopened" — the operator reopened it.
- **What changed since ADR-027.** Nothing technical invalidated AntD; what
  changed is the goal weighting. ADR-027 optimized for zero migration cost on a
  7-day horizon; the program blueprint optimizes the template's next year
  (adoption waves A1–A5 lean on the Tailwind ecosystem, and the 21/22
  comparison verdicts that read "skip: shadcn/Tailwind ecosystem" flip to
  adoptable once this lands).

## Decision

Replace Ant Design 6 across the template with:

- **Tailwind CSS v4** (CSS-first `@theme` block) as the styling layer.
  `brand.config.ts` stays the white-label single source, now emitting the CSS
  variables the `@theme` block consumes. Inter stays loaded via `next/font`,
  chained into the theme. Dark mode keeps the current `[data-theme]`/class
  strategy.
- **shadcn/ui** (Radix primitives, copy-in, MIT) as the component layer for app
  chrome, forms, tables, overlays. Data table = shadcn Table + **TanStack
  Table** (sorting/pagination parity with AntD Table is the hardest single item
  and is budgeted explicitly in Workstream C2). Forms = **react-hook-form +
  zodResolver** (zod already validates every boundary).
- **Tremor** (copy-in Tailwind dashboard components, built on Recharts) for
  charts, KPI cards, and dashboard surfaces — the operator-signed addition over
  the blueprint's original "bare recharts" line. **recharts stays** as the
  underlying chart engine (Tremor wraps it); **dnd-kit stays** for kanban.

**What survives** (concepts and surfaces, re-targeted):
- `brand.config.ts` as the one-file white-label contract (ADR-028 Phase 0).
- The `components/shared/*` prop APIs — Workstream C rebuilds internals
  **same-API** so screens keep compiling while the library swaps.
- The `docs/design-recipes.md` pattern catalogue, `/design-system` +
  `/design-qa` methodology, the slop gate, and tokens-as-single-source
  (`no-raw-hex-color` re-targets the `@theme` block; arbitrary-value colors
  like `bg-[#…]` are forbidden outside it).
- The standard app skeleton (ADR-027 Part 2) and optional RTL (ADR-028 Part 1 —
  C4 replaces physical CSS with Tailwind logical utilities `ms-*`/`me-*`/
  `start-*`, removing the `ConfigProvider direction` dependency entirely).

**What is discarded** (sunk cost, recorded honestly):
- `components/layout/antd-theme.ts` and all per-component AntD token overrides
  (ADR-028 Phases 1–3 code; the concepts — component depth, branded HOCs —
  are rebuilt on shadcn/Tremor).
- `antd`, `@ant-design/*` dependencies and the `@ant-design/nextjs-registry`
  SSR shim.

**Side benefit locked in:** removing AntD's CSS-in-JS lets the CSP drop the
`style-src 'unsafe-inline'` exception ADR-001 carried from day one (the
`script-src` inline exception for the Next bootstrap is a separate question).

**Execution:** big-bang on a branch, per the program blueprint Workstream C
(C1 foundation → C2 same-API primitives → C3 screen sweep with per-screen
`/design-qa` exit → C4 harness/guard updates). Lands on `main` only when
`/ship` + `/qa` are green end-to-end. No fork is forced to migrate until it
runs `/sync-from-template`.

## Consequences

### Positive
- Modern, "own product" aesthetic; Radix-grade a11y; best-in-class RSC fit
  (no runtime CSS-in-JS).
- Copy-in ownership: forks own the component source — no library lock-in for a
  template whose endgame is `/handoff`.
- CSP tightens (`'unsafe-inline'` style exception dropped).
- Unblocks adoption waves phrased against the Tailwind ecosystem (tweakcn,
  shadcn MCP servers, style-dictionary → `@theme`, density tokens).

### Negative
- ADR-028 Phases 0–4 AntD token work is sunk cost (code discarded, ~concepts
  survive). Recorded, accepted by the operator with the directive.
- Copy-in means we maintain Table/DatePicker/Form component code ourselves.
- 7–11 sessions of migration — the program's dominant cost — during which the
  branch diverges from `main`.
- TanStack-Table parity with AntD Table (column controls, bulk actions,
  pagination ergonomics in `DataView`) is a real risk, not just a port.

### Mitigations
- Same-API rebuild of `components/shared/*` contains the blast radius; screens
  compile throughout.
- Per-screen `/design-qa` exit bar (axe-clean serious/critical) prevents a
  taste/a11y regression from landing wholesale.
- `docs/deep-comparison/21–22` get a dated addendum flipping the
  AntD-conditional verdicts, so the adoption backlog stays truthful.

## Alternatives considered
1. **Stay on AntD (status quo, ADR-027).** Rejected by operator directive D3;
   the token-elevation ceiling was reached and the ecosystem weighting favors
   Tailwind for the template's next phase.
2. **shadcn/ui only, charts on bare recharts** (blueprint's original line).
   Rejected at sign-off: Tremor's copy-in KPI/chart components give dashboards
   the same vetted-pattern treatment shadcn gives chrome, at no lock-in cost.
3. **MUI / Mantine** (batteries-included swaps). Ranked behind shadcn in
   ADR-027's own table (RSC fit, lock-in, CSP); unchanged.
4. **HeroUI / Catalyst / TailAdmin** (packaged Tailwind kits, screenshotted in
   the sign-off pass). Rejected: runtime dependency or template-purchase
   model — weaker fit for a white-label, handed-off template than copy-in
   primitives.
5. **Incremental migration on `main`** (AntD and Tailwind coexisting).
   Rejected: a template is not a live product; a long mixed state costs more
   (double theming, double recipes) than a branch big-bang that lands green.

## Migration triggers
- Revisit if the copy-in maintenance burden (Table/Form/DatePicker) measurably
  outweighs ownership benefits across forks.
- Revisit the Tremor layer if Vercel's stewardship stalls it or Recharts
  compatibility breaks; fallback is direct recharts per the blueprint line.
- Re-audit the CSP once AntD is fully removed — dropping `'unsafe-inline'` for
  styles is the acceptance test that the CSS-in-JS surface is truly gone.

## Related
- `docs/blueprints/2026-07-replatform-and-adoption-program.md` — the signed
  program contract (Workstream C is this ADR's execution plan).
- ADR-027 (superseded Part 1; Part 2 skeleton stands), ADR-028 (Part 2
  superseded; Part 1 optional-RTL stands), ADR-001 (UI line amended),
  ADR-015 (design taste layer — re-targets), ADR-026 (native design system —
  method unchanged, substrate swaps), ADR-021 (TanStack Query — unaffected,
  now joined by TanStack Table).
- `docs/deep-comparison/21-design.md`, `22-uiux.md` — the evidence layer.
