# Hiring — job location on requisitions and the careers board

Scope: prisma/schema.prisma, prisma/migrations/*_hiring_job_location/**, lib/validations/hiring/requisition.ts, lib/hiring/careers.ts, lib/hiring/careers-jd.ts, app/[locale]/(careers)/careers/[slug]/page.tsx, components/hiring/**, messages/**, tests/contracts/hiring-job-location.test.ts, tests/contracts/ux-hiring.test.ts

Status: operator-approved overnight item 3 (2026-10-28 brief). Closes the "requisitions carry no
location" open question from `ux-p1-hiring.md` (every role was placed in Muscat, OM).

## Stories and acceptance criteria

- **US-1 (HR) set where a role is worked.** AC-1.1 The requisition form (new and edit) has City
  (1–80 characters), Country (ISO alpha-2, picked from a list; a stored code outside the list is
  kept) and Work arrangement (On-site / Hybrid / Remote). AC-1.2 A new requisition defaults to
  Muscat, Oman, on-site; existing requisitions were given the same by the migration's column
  defaults. AC-1.3 The requisition overview shows "Muscat, Oman · On-site". AC-1.4 Bad input
  is refused with a readable message (blank city, "Oman" instead of a code, an unknown arrangement).
- **US-2 (candidate) see and filter by location.** AC-2.1 Each careers card and the role page
  show the place and arrangement. AC-2.2 The board offers a Locations chip filter (by "City,
  Country") when roles are in more than one place; search matches the place too.
- **US-3 (search engines) structured data.** AC-3.1 `JobPosting.jobLocation` carries the city and
  country. AC-3.2 A remote role adds `jobLocationType: TELECOMMUTE` and
  `applicantLocationRequirements` (the country), keeping `jobLocation`.

## Worst paths

- A cached board entry from before the deploy has no location → the cache keys moved to `-v2`,
  so it is never read.
- A requisition raised through the hiring-request flow never shows the fields → it gets the
  defaults and HR edits them on the requisition.

## Data

`HiringWorkArrangement` enum; `hiring_requisitions.location_city` (default 'Muscat'),
`location_country` (default 'OM'), `work_arrangement` (default 'ON_SITE'). Additive, no back-fill
needed.
