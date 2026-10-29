# P2 — Visual org chart and effective-dated reorganisation

Scope: prisma/schema.prisma, prisma/migrations/*_p2_org_unit_changes/**, lib/org/changes.ts, lib/pms/org-chart.ts, lib/validations/org.ts, lib/jml/sweep.ts, app/api/org/changes/route.ts, app/api/org/changes/[id]/route.ts, app/[locale]/(dashboard)/org/page.tsx, components/org/**, messages/**, tests/contracts/p2-org.test.ts

Status: operator-approved P2 roadmap (2026-10-29). Source: UX audit `shell-people.md` R19.
Benchmarks: BambooHR / HiBob org chart (people cards, centre on a person, vacancies); Workday
effective-dated supervisory-org changes.

## Stories and acceptance criteria

- **US-1 (anyone with the chart) see the organisation as cards.** AC-1.1 `/org` opens in card mode:
  per company, one card per unit (and the leadership group) with its head, people count and its
  first people; "List" keeps the existing searchable tree (and `?q=` still opens the list). AC-1.2
  HR and executives (org-wide readers) also see open roles per department: openings on OPEN or
  REOPENED requisitions. Others do not (a replacement requisition can be confidential). AC-1.3
  "Centre on a person" shows their manager above, them, and their direct reports below; picking a
  card re-centres. Everything is drawn from the already-scoped set (§4.2), so a manager outside the
  reader's visibility is absent.
- **US-2 (org manager) schedule a reorganisation.** AC-2.1 Org setup → Scheduled changes: rename a
  directorate, department or team, and/or move a department to another directorate (or none) or a
  team to another department, from a date. Bad input is refused with the field and the reason.
  AC-2.2 The JML hourly sweep applies due changes (organisation zone) through the same org services
  as an immediate edit, so every placement and naming rule holds on the date; a refusal then marks
  the change "Refused" with the reason. A change dated today or earlier applies at once. AC-2.3
  Scheduled changes can be cancelled; applied, refused and cancelled ones stay as history with what
  the unit was called and where it sat. Org managers only (`orgManage`).

## Worst paths

- The unit is retired before the date → refused: "The unit no longer exists."
- Another unit took the name meanwhile → refused with the naming rule's sentence.
- A department scheduled to move company → not offered (moving company is a per-person transfer).
- 50+ changes due at once → 50 per sweep run, the rest the next hour.

## Data

`org_unit_changes` (+ enums `OrgUnitKind`, `OrgChangeStatus`): unit, effective date, new name, move
flag + new parent, status, before name/parent, applied at, failure reason, created by (plain id).
