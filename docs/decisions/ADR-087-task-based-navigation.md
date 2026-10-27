# ADR-087 — Task-based navigation from one typed config

**Status:** Accepted
**Date:** 2026-10-27
**Decision owner:** Tariq Al-Naaimi (operator approval of UX review P1)
**Reviewers:** —

## Context

After the four apps merged, the sidebar grouped screens by the app they came from and copied each
module's whole menu into the global nav (~49 rows for full access). Navigation was declared in
three places — `AppSidebar`, a ⌘K palette with six static commands, and breadcrumbs that
humanised URL segments — and they disagreed. The ticket module still lived at `/hive/*`.

## Decision drivers

- One answer to "where is X" for every surface (sidebar, ⌘K, breadcrumbs, tab bar, launcher).
- Persona-first: a line manager should see ~6 entries, not 49.
- Gates stay affordances; the server keeps every check.
- Old links in sent emails and notifications must keep working.

## Considered options

### Option 1 — One typed config + pure resolvers (chosen)

`lib/nav/config.ts` declares entries (group, icon, label, href, gate, tabs); `lib/nav/resolve.ts`
derives the sidebar, the active entry (longest prefix), the module tab bar, the palette list and
the breadcrumb head. The client builds the gate context from the existing access hooks; the server
twin (`lib/nav/server-context.ts`) builds the same context for hub pages.

- Good, because adding a screen is one entry and every surface follows.
- Good, because it is pure and unit-tested (tests/contracts/ux-nav.test.ts), including "every
  destination is a real page".
- Bad, because module pages now share one tab-bar style instead of bespoke sub-navs.

### Option 2 — Collapsible groups over the existing per-module lists

- Good, because smallest change.
- Bad, because it keeps three definitions and the persona mixing; collapsed groups still hide
  where things are.

### Option 3 — Per-page `nav` metadata discovered from the file system

- Bad, because gates and tabs span modules and the sidebar would have to load every page module.

## Decision

Option 1. Sidebar groups: Home · Me · My team · People · Talent · Service · Insights · Admin. A
module is one entry; its sub-pages are an in-page tab bar. Reports from every module are tabs of
one Insights entry; module configuration pages are tabs of one Admin › Settings entry. The ticket
screens move to `/tickets/*`, with permanent `next.config.ts` redirects for every old `/hive/*`
page (no middleware change); the public reply link and `/api/hive/*` do not move.

## Consequences

- `components/jml/nav.tsx` and `components/hiring/nav.tsx` are gone; `/scaffold-entity` now
  inserts its nav entry into `lib/nav/config.ts`.
- A full-access user sees 17 entries instead of ~49.
- New tickets are numbered `HR-<n>`; old `HIVE-<n>` ids remain searchable.
