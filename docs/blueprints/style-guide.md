# Blueprint — Style guide / archetype demo route (V2-303)

Scope: app/[locale]/(dashboard)/style-guide/**

Track: **Lightweight** (a template-owned demo surface, not a product feature).

## Problem & outcome

A single dashboard route that renders the shipped `components/shared/*` layout primitives and the
five page archetypes (list · detail · form · dashboard · settings) as a **living reference** — so an
agent (or a human) can see the on-token, RTL/dark-correct patterns rendered, and `/design-qa` /
V2-301 captures have a canonical target. Read-only; no data mutation; ADMIN-gated like the rest of
the dashboard.

## Design read

Surface: internal reference gallery · audience: the operator/agent building UI · tone: neutral,
restrained · density: comfortable · primary action: none (it's a gallery). Archetype: it demoes all
five; the page itself is a **dashboard**-archetype shell (`PageShell` + `PageHeader` + sections).

## Architecture

- `app/[locale]/(dashboard)/style-guide/page.tsx` — the template-shipped style-guide (a client
  component; token/control gallery), **extended (V2-303)** with a "Page archetypes" section that
  renders the five archetypes on the V2-302 primitives: `StatGrid`+`StatCard` (dashboard),
  `DescriptionList` (detail), `FormLayout` (form), `Toolbar`+`EmptyState` (list), grouped controls
  (settings). No API route, no DB write — static sample content only.
- Reuses only existing primitives + the three new V2-302 ones. No new dependency, no new lib.
  (The page pre-exists, so the blueprint-gate isn't tripped; this blueprint documents the archetype
  design-read + gives V2-303 its "a blueprint declares an archetype" evidence.)

## Open questions

- [x] Should it be a product route or dev-only? → a `(dashboard)` route (ADMIN-gated by the layout),
      kept as a template reference; forks may delete it. No separate auth.

Confirmed: Tariq Al-Naaimi 2026-07-17 (lightweight track; operator waved the interactive round).
