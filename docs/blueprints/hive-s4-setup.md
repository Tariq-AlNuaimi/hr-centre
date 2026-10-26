# Blueprint — HR tickets slice 4: reports and the reference-data screens

Scope: app/api/hive/admin/**, app/[locale]/(dashboard)/hive/**, lib/hive/services/**, lib/hive/provider-import.ts, lib/validations/hive/**, components/hive/**, components/shared/Chart.impl.tsx, scripts/hive-import-providers.mjs, package.json, SECURITY.md

Status: part of `docs/blueprints/hive.md` (slice 4). Stories US-H8 (reports) and US-H9 (reference
data). HIVE had NO screen for pairs, members, coverage, rotation, discounts, providers or the org
chart (HIVE spec §5: seed, direct DB edits and the provider script only); the operator asked for
full CRUD here, permission-gated.

## What this slice delivers

- Reports (`/hive/reports`, `GET /api/hive/admin/reports`) ported from HIVE: counts only, Muscat
  days, ≤ 366 days, daily ≤ 92 days else weekly from Monday, median hours to answer.
- `tickets.configure` screens, each server-gated by `(setup)/layout.tsx`:
  - `/hive/pairs` — pairs (name, order, default), members (linked to the HR Centre login with the
    same email — the OWN_HR_PAIR link; never typed, so editing a contact card cannot grant
    access), coverage (label, aliases, company, company-wide flag, optional unit links);
  - `/hive/rotation` — anchor Sunday, week type, time zone, weekend days (now READ by the tool),
    groups (constant / group 1 / group 2) and their teams;
  - `/hive/discounts` — partners, eligibility, expiry (empty = not specified), redemption;
  - `/hive/providers` — search, paging, row edits and the spreadsheet upload (same parser and
    rules as `npm run hive:providers`; replace retires the list through the audited soft delete);
  - `/hive/org-details` — leader, title and order per core unit for `hive_org_structure`.
- One generic editor (`components/hive/admin/ReferenceManager.tsx`) over
  `/api/hive/admin/ref/[resource]` (closed list of seven resources; zod per resource).
- `npm run hive:providers -- <file.xlsx> [--replace]`.

## Worst paths checked

Unknown resource (404), company-wide row without a company (400 sentence), anchor not a Sunday,
unknown time zone, a member email already in a pair (409), a login already linked to another
member (left unlinked), a sheet with no rows or missing name/location columns (nothing changed),
rows missing a location (reported by line, not dropped). Fixed a HIVE latent bug: read-excel-file
v9 returns the workbook, not the rows (HIVE's script would read every real file as empty).
