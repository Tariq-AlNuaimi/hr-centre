# Blueprint — Enterprise design-system overhaul + optional Arabic/RTL

Status: **IN PROGRESS** — decisions signed off (1A config-flag English-only,
2A full overhaul Phases 0–4, 3A one brand.config per client).

## Implementation status
- ✅ **Part 1 — Arabic/RTL optional** (config flag). `locales`/`defaultLocale`
  in `project.config.json` → `i18n/config.ts` (single source: routing,
  `localePrefixRegex`, `localeDirection`, switcher visibility). All six
  hardcoded `(en|ar)` regexes replaced; UAT RTL assertion + URL building are
  config-driven; recipe docs + `app/page.tsx`/`not-found.tsx` no longer hardcode
  `/en`. `messages/ar.json` kept inert.
- ✅ **Phase 0 — Brand contract & font.** `brand.config.ts` (white-label single
  source) feeds `antd-theme.ts` + layout; Inter loaded via `next/font`.
- ⏳ Phases 1–4 — in progress.

---

(Original draft below.)

Status: **DRAFT — awaiting operator sign-off on the 3 decisions below.**
Owner: Tariq Al-Naaimi. Created: 2026-06-26.
Context: operator wants apps that look *enterprise-grade / sellable to clients*
("they look like amateur projects"), and wants Arabic/RTL **optional** ("I don't
need it in most my apps"). Constraint from ADR-027: **stay on Ant Design 6** —
elevate it, don't swap the library.

This blueprint is the contract `/qa` / `/uat` will trace against once a scope is
chosen. Build it via `/blueprint` (full track) → phased PRs, each `/ship`-green.

---

## Decisions needed before building (operator)

1. **i18n/RTL strategy** — *Recommended: config flag, default English-only.*
   - (A) Config flag, default `["en"]`; keep `ar.json` + RTL code, one-line
     opt-in per fork. Reversible, nothing deleted. ← recommended
   - (B) Remove Arabic entirely (strip `ar.json` + switcher + direction code).

2. **Design-system scope** — *Recommended: full overhaul (Phases 0–4).*
   - (A) Full overhaul, Phases 0–4 (multi-PR, fully sellable). ← recommended
   - (B) Foundation + chrome only (Phases 0–2).
   - (C) Quick visual polish only (Phase 1).

3. **Per-client white-label theming** — *Recommended: yes.*
   - (A) One `brand.config` per client (color/logo/font/name/favicon). ← recommended
   - (B) Single house style for now.

---

## Part 1 — Arabic / RTL → optional

### Current wiring (audited 2026-06-26)
- `i18n/routing.ts:4` — `locales: ["en","ar"]`, `defaultLocale: "en"`.
- `middleware.ts` — `/^\/(en|ar)/` regex in 3 places (strip + 2 redirect paths).
- `i18n/request.ts:6,12` — validates against `routing.locales`; dynamic-imports
  `messages/${locale}.json`.
- `app/[locale]/layout.tsx:48,70` — `direction = locale === "ar" ? "rtl":"ltr"`;
  `<html lang dir>`.
- `components/layout/ThemeProvider.tsx:37,75` — AntD `ConfigProvider direction`.
- `components/layout/AppHeader.tsx:29-33,92-99` — locale switcher (toggle + regex).
- `AppSidebar.tsx:34`, `Breadcrumbs.tsx:28` — same `(en|ar)` regex (active-key).
- `messages/en.json`, `messages/ar.json`.
- `next.config.ts:6` — `createNextIntlPlugin("./i18n/request.ts")`.
- UAT: `tests/uat/uiux.full.uat.ts:14,22` assert the `ar` RTL flip.
- `docs/recipes/dx/1-storybook.md:79-81` hardcodes `"en"|"ar"`.
- No DB column for user locale (URL-driven only).

### Plan (option A — config flag, recommended)
1. Add to `project.config.json`: `"locales": ["en"]`, `"defaultLocale": "en"`
   (a fork needing Arabic sets `["en","ar"]`).
2. `i18n/routing.ts` reads those values (single source of truth).
3. Replace the 6 hardcoded `(en|ar)` regexes with a generated
   `new RegExp(`^/(${locales.join("|")})`)` derived from config (export a shared
   `localePrefixRegex` helper so the switcher/sidebar/breadcrumbs/middleware all
   import one definition — removes the duplication the audit found).
4. Direction: a `localeDirection: Record<string,"ltr"|"rtl">` map (`ar→rtl`);
   `<html dir>` + AntD direction derive from the *active* locale. English-only
   forks are always `ltr`.
5. Locale switcher renders **only when `locales.length > 1`** (no dead globe
   button on English-only forks).
6. Keep `messages/ar.json` + all RTL code in the repo, inert until re-enabled.
7. `middleware.ts` is **Ask-before** → plan + `/code-review` before push.
8. Update `tests/uat/uiux.full.uat.ts` to skip the RTL assertion when `ar` is
   not configured; document the flag in README + `docs/agent-memory.md`.
9. Note CLAUDE.md trap: "Adding a locale means updating the regex in
   middleware.ts" — this change makes that automatic; update the trap text.

---

## Part 2 — Enterprise design-system overhaul (Ant Design 6)

### Honest audit finding (2026-06-26)
The **foundation is already solid**: locked token scale (`app/tokens.css`),
`no-raw-hex` enforced, a recently-elevated indigo theme (`antd-theme.ts`,
commit 79d7073), opinionated shared primitives (PageHeader/DataTable/EmptyState/
Skeletons), dark mode, a11y baseline, `/design-system` + `/design-qa` loop.

It still reads "starter/amateur" to a client because of **four gaps**:
1. **No real brand identity** — Inter is *declared* but never loaded (system-font
   fallback); no per-app brand → every app is the same generic indigo AntD admin.
2. **Thin product chrome** — no ⌘K palette, no global search, no notifications,
   no org/workspace switcher, default unbranded 404/500, plain login.
3. **Sparse content** — dashboard is 3 cards + a chart; stock AntD tables; no KPI
   system, bulk actions, saved views, or "finished product" density.
4. **No visual proof** — no component gallery/Storybook showing all states.

### Phased roadmap (each phase ships `/ship`-green + is independently valuable)
- **Phase 0 — Brand contract & font.** `brand.config.ts` (white-label:
  primary/accent, logo, font, radius, density, app name, favicon) consumed by
  `antd-theme.ts` + layout. Actually load the font via `next/font`. → the
  multiplier for selling per-client (decision 3).
- **Phase 1 — Visual foundation depth.** Component-level AntD token overrides
  (Table, Card, Button, Input, Menu, Tabs, Modal), refined neutrals/borders/
  shadows/type scale + a `/design-qa` sweep to fix residual spacing/hierarchy.
- **Phase 2 — Product chrome.** Polished `AppShell` (collapsible sectioned
  sidebar, refined top bar), ⌘K command palette + global search, notifications,
  org switcher, **branded auth pages** (split-screen) + **branded error pages**
  (404/403/500/maintenance). Touches `lib/`/`middleware`? keep auth wrappers
  intact; Ask-before files get `/code-review`.
- **Phase 3 — Component & data system.** Branded higher-order components
  (KPI/StatCard, SectionCard, DataView w/ bulk actions + row select + column
  controls, DescriptionList detail view, Toolbar) + an enriched dashboard.
- **Phase 4 — Proof & docs.** Component gallery (all states, light/dark/RTL),
  updated `docs/design-recipes.md`, ADR-028 superseding/extending ADR-027.

### Guardrails (all phases)
- Five Pillars are gates; `/ship` green before every push.
- No raw hex (tokens only); one accent, one primary action per screen; honest
  state triad; axe-clean; RTL + dark hold (RTL only when a fork enables `ar`).
- Reuse the shipped `components/shared/*` primitives; extend, don't fork them.
- Run `/design-qa` per screen before calling a phase done.

### Suggested branch/PR sequence
1. `feat/i18n-optional-rtl` (Part 1) — small, self-contained.
2. `feat/design-phase-0-brand-font`
3. `feat/design-phase-1-tokens`
4. `feat/design-phase-2-chrome`
5. `feat/design-phase-3-components`
6. `feat/design-phase-4-gallery-docs`

(Scope collapses to fewer PRs if the operator picks 2B or 2C.)
