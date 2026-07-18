# Blueprint — Manzil design-system showcase route

Scope: app/[locale]/design-system/**

Track: **Lightweight** (a template-owned showcase surface, not a product feature).

## Problem & outcome

The Rihal Design System has a canonical **landing showcase** (the "Manzil · Design System" page:
living hero + Why / Color / Type / Components / AI-patterns / Adoption sections) that communicates the
one-contract story to stakeholders adopting the template. It has only ever existed as a standalone
`.dc.html` mockup rendered outside the app. This route makes it a **real, on-stack page** built on the
shipped tokens + shadcn/Tailwind primitives + the `components/shared/ai/*` primitives — so the
showcase is the running design system, not a picture of it, and every value it prints is read from the
token source (no drift). Read-only; no data mutation.

## User stories

- As a **stakeholder** evaluating the template, I open `/design-system` and see the brand, type,
  components, and AI patterns as one coherent, on-brand surface (light + dark).
- As an **operator/agent** building UI, I use it as the fidelity reference for the AI-pattern
  primitives and the royal/Geist token contract.

## Design read

Surface: branded design-system landing · audience: stakeholders + operator/agent · tone: calm, dense,
operational · density: comfortable · one accent (royal), one primary action per screen (the command
bar) · Archetype: **non-archetype marketing/landing** (rationale: it is a design-system showcase with
its own full-bleed chrome — a top bar + section nav + in-page theme toggle — so it deliberately does
NOT use the dashboard `AppShell`; it lives outside the `(dashboard)` group and gets only the locale
providers layout). Authed by default (middleware gates every non-public path); no middleware change.

## Happy / worst-path scenarios

- **Happy:** logged-in user loads `/en/design-system` → full showcase renders, light/dark toggle flips
  the whole surface via the app ThemeProvider, ⌘K / "Try the command bar" opens the in-page palette,
  every CTA/anchor resolves to a section on the page.
- **Worst:** anon user → middleware redirects to `/login` (no special-casing). Reduced-motion users →
  the decorative animations are non-essential (content is fully legible frozen). Narrow viewport → the
  hero + card grids collapse to one column.

## Architecture

- `app/[locale]/design-system/page.tsx` — a client component (theme toggle, ⌘K palette, small
  decorative state). Full-bleed: only the `[locale]` providers layout wraps it (no `AppShell`).
- Reuses: `components/ui/*` (Button, Badge), `components/shared/ai/*` (AiAssistPanel, AiStreaming,
  ConfidenceChip, CitationLink, ResponsibleAiBanner, AgentActivity), `useTheme()`, `brand.config.ts`,
  `chart-palette.ts`. Values shown as text (hex, chart series) are READ from those sources.
- No API route, no DB, no new dependency. A self-contained command-palette overlay (open on ⌘K + the
  CTA, close on esc/backdrop) keeps the ⌘K CTA honest without depending on the dashboard chrome.
- Copy is intentionally hardcoded (a dev/design reference, exempt from the next-intl convention — same
  carve-out as `/style-guide`); everything it demonstrates flows through tokens + shared components.

## Open questions

- [x] New route or replace `/style-guide`? → **new route** `/design-system`; `/style-guide` stays the
      utilitarian component reference. They are complementary.
- [x] Public or authed? → **authed** (default), full-bleed outside `(dashboard)`. No middleware change;
      a fork can add it to `PUBLIC_PATHS` if it wants an unauthenticated landing.
