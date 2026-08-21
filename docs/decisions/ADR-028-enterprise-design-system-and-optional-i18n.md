# ADR-028 — Enterprise design-system overhaul + optional Arabic/RTL

> **PARTIALLY SUPERSEDED by [ADR-029](ADR-029-ui-replatform-antd-to-tailwind-shadcn.md)** — Part 2's AntD-specific layers (`antd-theme.ts`, per-component AntD token overrides) are superseded. Part 1 (optional Arabic/RTL) still stands.

**Status:** Part 1 (optional Arabic/RTL) remains Accepted. Part 2's **AntD-specific layers**
(`antd-theme.ts`, per-component AntD token overrides) **superseded by ADR-029** (2026-07-02);
Part 2's concepts (brand contract, chrome, branded HOCs, living style guide) survive and are
rebuilt on Tailwind/shadcn/Tremor per ADR-029.
**Date:** 2026-06-26
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Extends:** ADR-027 (keep Ant Design 6, elevate at the token level — do NOT swap the library).
**Relation to ADR-001:** the locked stack stands (`UI: Ant Design 6`); this ADR adds layers on top, no swap.

## Context

ADR-027 settled the library question — **stay on AntD, elevate it** — and shipped the first token pass
(refined indigo theme, softer radius, premium type, layered elevation). Two gaps remained, raised by the
operator: (1) apps still read "starter/amateur" to a client because there was **no real brand identity, thin
product chrome, and a sparse component system**; and (2) Arabic/RTL was **always on**, but "most apps don't
need it." Blueprint: `docs/blueprints/enterprise-design-system-and-i18n.md` (signed off: config-flag
English-only default · full overhaul Phases 0–4 · one `brand.config` per client).

## Decision

### Part 1 — Arabic/RTL is optional (config flag, default English-only)

`project.config.json` `locales` / `defaultLocale` are the single source. `i18n/config.ts` derives the
next-intl routing, the `<html dir>` direction (`localeDirection` / `directionForLocale`, RTL automatic for
`ar`/`he`/`fa`/`ur`), a shared `localePrefixRegex` (replacing **six** hardcoded `/^\/(en|ar)/` regexes), and
switcher visibility (`hasMultipleLocales`). Default ships `["en"]`; a fork enables Arabic by setting
`["en","ar"]`. `messages/ar.json` + all RTL code stay in the repo, **inert** until re-enabled — reversible,
nothing deleted. The UAT RTL assertion and URL building are config-driven (skip when no RTL locale ships).

### Part 2 — Enterprise design system on AntD (Phases 0–4)

All built on AntD + the shipped `components/shared/*` primitives (ADR-027's "elevate, don't swap"):

- **Phase 0 — Brand contract & font.** `brand.config.ts` is the white-label single source (app name,
  primary/accent, radius, density, font, theme-color). `antd-theme.ts` + layout + chrome derive from it. The
  UI font (Inter) is **actually loaded** via `next/font` (self-hosted, no runtime Google request), bound to a
  CSS variable the AntD `fontFamily` token chains. `brand.config.ts` joins `antd-theme.ts` as a
  `no-raw-hex-color`-exempt token source.
- **Phase 1 — Component token depth.** Per-component AntD overrides (Input family focus ring, Tabs, Tooltip,
  Dropdown, Card, Form, Tag, Segmented) + per-mode neutrals so dark mode stays correct.
- **Phase 2 — Product chrome.** Branded split-screen auth; a ⌘K command palette + global search; a
  notifications bell (honest empty state); a workspace/org switcher (honest single-tenant); branded status
  pages (404/403/500/maintenance) via one `BrandedStatus` primitive.
- **Phase 3 — Branded HOCs.** `StatCard` (KPI), `SectionCard`, `DataView` (DataTable + toolbar + bulk actions
  - row selection + column controls), `DescriptionList`, `Toolbar`; the dashboard rebuilt on them.
- **Phase 4 — Proof & docs.** The `style-guide` page extended into the living gallery (all primitives across
  light/dark/RTL); `docs/design-recipes.md` updated (recipes 9–13); this ADR.

### Guardrails (unchanged from ADR-027 / CLAUDE.md)

Stay on AntD. Tokens only — no raw hex outside `antd-theme.ts` / `brand.config.ts` (`no-raw-hex-color` at
error; `rgb()`/`rgba()` is the documented escape for context-free boundaries). One accent + one primary action
per screen; honest empty/loading/error states; axe-clean; RTL + dark hold (RTL only when a fork enables `ar`).
Reuse the shared primitives; extend, don't fork. `/ship` green before every push.

## Consequences

- **Per-client white-label is one file.** A fork rebrands by editing `brand.config.ts` (+ replacing
  `app/favicon.ico`); no per-component edits. The font swap is two coordinated edits (next/font import +
  `brand.font`), lockstep-tested.
- **English-only forks are leaner + simpler.** No dead locale switcher, no RTL surface to reason about; adding
  Arabic later is a one-line config change with everything already wired.
- **The chrome is the seam, not the wall.** Notifications and the workspace switcher ship honest
  empty/single-tenant states; a fork wires a real feed / multi-tenancy at the documented seam (no fake data).
- **CSP unchanged.** AntD's CSS-in-JS still requires `style-src 'unsafe-inline'` (ADR-001/027); this overhaul
  did not touch that trade-off. Revisit at AntD 7.
- **Maintenance page** ships behind auth as-built; making it public is a one-line `publicPaths` addition
  (Ask-before, middleware.ts) wired per `/scale-up` when a fork needs a maintenance window.
- The library-swap comparison in ADR-027 remains the record if the question is reopened; this ADR does not
  reopen it.
