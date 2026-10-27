# UX review P1 — phases 1–2: one navigation, one set of names, one Settings hub

Scope: lib/nav/**, components/layout/**, components/shared/LinkCards.tsx, app/[locale]/(dashboard)/admin/settings/**, app/[locale]/(dashboard)/tickets/**, app/[locale]/(dashboard)/hive/**, lib/hive/**, components/hive/**, lib/rbac/**, lib/hiring/roles.ts, prisma/seed.ts, prisma/seed-foundation.ts, prisma/seed-ux-p1.ts, prisma/schema.prisma, prisma/migrations/**, next.config.ts, scripts/scaffold-entity.mjs

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1 after P0, merge and deploy".
Source: UX review — shell/people R7 + R8 (§4.1 target IA), performance/JML P1-2, tickets/hiring
P1-1 + P1-6. Re-verified against `main` at 99aae5d (after P0: the launcher, "My work" on Home,
the settings stub removed from the sidebar, "Roll-ups & split years" already renamed).

## Why

The sidebar is grouped by the app each screen came from and copies every module's internal menu
into the global nav: about 49 rows for a full-access user, Hiring alone 13. Three places define
navigation (the sidebar, ⌘K with six static commands, breadcrumbs that humanise URL segments), so
they disagree ("Admin / Cycles" under a "Performance" sidebar group). The ticket module has four
names and still shows the retired product name (`/hive/*` URLs, `HIVE-1003` ids, history actor
"HIVE"). Role names mix casing ("Hiring admin" beside "HR Super Admin").

## Stories and acceptance criteria

### US-1 — One nav definition

- AC-1.1 `lib/nav/config.ts` is the only place destinations are declared: key, label, href,
  group, icon, gate, and optional tabs. The sidebar, the module tab bar, ⌘K and the breadcrumbs
  all read it (`lib/nav/resolve.ts`). Adding a screen is one entry.
- AC-1.2 Gates are affordances; every route keeps its own server check. Gates fail closed while
  access is loading.

### US-2 — Task-based, persona-aware sidebar

- AC-2.1 Groups, in order: Home · Me · My team · People · Talent · Service · Insights · Admin. A
  group renders only when it has an entry the viewer may open.
- AC-2.2 Me: My profile (own record), My performance (tabs Scorecard · Mid-year · Year-end), My
  interviews (Hiring panel). My team: My team (tabs Team · Goal setting; line managers and HR).
  People: Directory, Org chart, Joiners & leavers. Talent: Hiring, Performance cycles. Service: HR
  tickets. Insights: one hub. Admin: Settings, Roles & access, Audit log, Recycling bin.
- AC-2.3 Each module is ONE sidebar entry opening on its first tab the viewer may use; its
  sub-pages are an in-page tab bar shown on every page of the module (two or more visible tabs).
  Joiners & leavers: Overview · My tasks · Cases · Joiners · Movers · Leavers · Joining calendar ·
  Statutory watch. Hiring: Overview · Requisitions · Candidates · Pipeline · Interviews · Offers ·
  Close-out · Approvals · Sourcing · Library. Performance cycles: Cycles · 360 · Calibration ·
  Corporate scores · Roll-ups & split years.
- AC-2.4 The page a path belongs to is the longest matching prefix, so `/jml/reports` lights
  Insights, `/hiring/panel` lights My interviews, `/people/<me>` lights My profile.
- AC-2.5 A full-access user sees ≤ 17 sidebar entries (was ~49).

### US-3 — One Insights hub

- AC-3.1 "Insights" is one sidebar entry whose tabs are Executive · Performance · Joiners &
  leavers · Hiring · HR tickets, each the module's existing report screen, each gated by that
  module's report permission. No report is reachable only from its module's menu any more.

### US-4 — ⌘K finds pages and people

- AC-4.1 The palette lists every destination (entries and tabs) the viewer may open, each with
  its module as a hint.
- AC-4.2 Typing 2+ characters also searches people by name, email or employee ID through the
  directory API (server-scoped to whom the viewer may see), ≤ 6 hits, debounced; a hit opens the
  record.

### US-5 — Breadcrumbs match the nav

- AC-5.1 The trail starts with the module entry and its tab from the config (e.g. "Performance
  cycles / Calibration", "Hiring / Requisitions / <segment>"), then the remaining path segments.

### US-6 — "HR tickets" everywhere

- AC-6.1 Ticket screens live at `/tickets` (queue), `/tickets/<id>`, `/tickets/reports`,
  `/tickets/setup/**`. Every old `/hive/**` page URL — bookmarks, sent emails, notifications —
  redirects permanently to its new home (next.config redirects). The public reply link
  (`/reply/<token>`) and `/api/hive/**` are unchanged.
- AC-6.2 New tickets are numbered `HR-<n>`; the default prefix becomes `HR` and an
  unedited `HIVE` prefix on the settings row is moved to `HR` once. Old `HIVE-<n>` ids stay
  searchable (the queue already accepts any prefix).
- AC-6.3 History rows name the actor "Siraaj" (the assistant) or "Employee", never "HIVE"; no
  user-facing copy says "HIVE".

### US-7 — Names

- AC-7.1 "Org chart" is the people view; "Organisation structure" is the admin setup screen.
- AC-7.2 "Roles & access" is one entry with tabs Roles · Logins & access.
- AC-7.3 Built-in role names are Title Case ("Hiring Admin", "Ticket Viewer", "Ticket Drafter",
  "Ticket Approver", "Tickets Admin"). A deploy renames a built-in role only when its name is
  still the old default — an admin's own rename is never overwritten.

### US-8 — Admin › Settings hub (R9)

- AC-8.1 `/admin/settings` is one Settings entry with one tab per area: General · Organisation
  structure · Email templates · Imports · Performance · Joiners & leavers · Hiring · HR tickets.
  The existing area pages are re-parented (they gain the hub's tab bar), not rewritten.
- AC-8.2 General lists the areas the viewer may open, built server-side from the same nav config
  (`lib/nav/server-context.ts`), each with a one-line purpose. No area → 404.
- AC-8.3 Email templates lists the JML email templates and the HR ticket answer email (each
  gated by its module's permission); Performance lists the cycle console, corporate scores and
  360 setup (HR only). Each destination keeps its own server gate.

## Scenarios

- Happy: a line manager signs in and sees Home, My profile, My performance, My team, Directory,
  Org chart — six entries. HR Super Admin with every module sees ~17.
- Happy: a sent email links `/en/hive/escalations/abc`; the reader lands on `/en/tickets/abc`.
- Worst: the access hooks fail — every gate is false, the viewer sees Home, Me and People only;
  pages still load by URL and enforce their own checks.
- Worst: an admin renamed "Hiring admin" to "Recruitment lead"; the deploy leaves it alone.
- Worst: a module grants a single tab (a panel-only reader) — no tab bar, the entry opens it.

## Architecture

`lib/nav/config.ts` (data + gates over a `NavContext`) → `lib/nav/resolve.ts` (pure: visible
entries, grouped sidebar, longest-prefix active match, tab bar, palette items, breadcrumb head) →
`components/layout/use-nav-context.tsx` (assembles `NavContext` from `usePmsActor`,
`useHiveAccess`, `useJmlAccess`, `useHiringMe`) → `AppSidebar`, `ModuleTabs` (new, mounted once
in `AppShell`), `CommandPalette`, `Breadcrumbs`, `OrgSwitcher`. `components/jml/nav.tsx` and
`components/hiring/nav.tsx` are deleted. Redirects are static `next.config.ts` redirects (no
middleware change). Migration `ux_p1_ticket_prefix` changes the column default only.
ADR-087 records the IA decision. `components/shared/LinkCards.tsx` is the card grid the
settings hub and the HR tickets setup hub share.

## Open questions

- Should "Me" grow "My requests" once employees sign in (SSO)? Deferred to the SSO phase.
