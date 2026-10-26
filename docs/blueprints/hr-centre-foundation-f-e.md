# Blueprint — HR Centre foundation, slice F-e (the HR Centre shell)

Scope: components/layout/AppSidebar.tsx, components/people/**, components/pms/EmployeeColumns.tsx, components/dashboard/DashboardContent.tsx, app/[locale]/(dashboard)/page.tsx, app/[locale]/(dashboard)/people/**

Status: SIGNED OFF as part of `docs/blueprints/hr-centre-foundation.md` (operator,
2026-10-26), delivery slice 5: "navigation by module, People directory and
employee record page (the base later modules add their tabs to)".

## What this slice delivers

- **Navigation by module.** The sidebar is grouped Start / People / Performance /
  Admin. Each item keeps its own visibility rule; `NAV_GROUP_OF` only decides
  where it sits, and an unknown key (a scaffolded entity) falls into Admin. A
  later module adds a group and its keys — nothing else changes.
- **Home = My tasks.** Home leads with what is waiting on the signed-in person
  (Performance's existing My tasks / oversight cards); the platform overview
  (users, audit, recycling bin) moves below it and shows for platform admins only.
- **People directory** stays the paginated, scope-filtered list (F-c scopes
  applied in the query) and gains the Team column.
- **Employee record tabs.** Overview (identity, placement, employment, job and
  contract, personal and ID details as permitted, compensation, login) and
  Performance (360 result, view/act note). Tabs are links (`?tab=`), so each is
  addressable and the server renders only the panel shown; a module adds its tab
  to `RECORD_TABS` in `components/people/RecordTabs.tsx`.

## Design read

Follows the platform look v0.2 tokens already in the repo (one teal accent,
slate neutrals, no gradients); existing primitives only (SectionCard,
DescriptionList, PageHeader, Badge). Group headings are small muted labels so
the active item stays the one accent on the sidebar.
