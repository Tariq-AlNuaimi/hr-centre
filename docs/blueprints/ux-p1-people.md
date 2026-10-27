# UX review P1 — phase 3: the employee record and the directory

Scope: app/[locale]/(dashboard)/people/**, app/[locale]/(dashboard)/org/page.tsx, app/api/employees/route.ts, lib/validations/employee.ts, lib/people/history.ts, lib/people/pending-id.ts, components/people/**, components/pms/**, components/shared/FilterBar.tsx, hooks/use-controllable-open.ts

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1".
Source: UX review shell/people R10 + R11. Re-verified on `main` at bd9313f.

## Why

The record had two edit buttons ("Edit details" for job/personal/IDs, "Edit record" for
placement and salary), loose departure buttons, and one long Overview of nine stacked cards with
no history. The directory filtered by status only, showed pay by default to anyone entitled, and
printed `PENDING-0e79…` / `BOOTSTRAP-ADMIN` as employee IDs.

## Stories and acceptance criteria

### US-1 — Header, one Edit, one Actions menu

- AC-1.1 Header: initials, name, "job title · department · company", status chip, "Reports to
  <manager>" link.
- AC-1.2 ONE Edit control. When the viewer may edit both halves it opens a menu of the two
  sections ("Employment & placement", "Job, personal and ID details"); with one, it opens it
  directly. Same forms, same routes, same server checks as before.
- AC-1.3 An Actions menu: Start mover case, Start leaver case (each only with the JML permission in
  the person's scope), View in org chart (`/org?q=<name>` opens the chart searched for them),
  Manage login (with `logins.manage`), and — separated, destructive — "Record departure without
  exit process" for the HR Super Admin only.

### US-2 — Category tabs

- AC-2.1 Tabs: Overview · Job & placement · Personal · Documents & IDs · Compensation ·
  Performance · HR tickets · Joiners & leavers · Hiring · History.
- AC-2.2 Personal, Documents & IDs and Compensation exist only when the gated select returned
  their data (`people.viewPersonal`, `people.viewIdDocuments`, `people.viewSalary`); module tabs
  keep their own gates; an unentitled `?tab=` shows Overview.

### US-3 — History

- AC-3.1 History lists the record's audit rows (newest 50): action, the changed field NAMES, who,
  when. Values are never read (no `before`/`after` in the select), so a salary or ID change is an
  event without either value.
- AC-3.2 Shown to whoever may edit this person (`people.edit` in scope).

### US-4 — Directory

- AC-4.1 Filters Company · Directorate (when the company has them) · Department · Team · Role
  track · Manager, in the URL, applied server-side by `GET /api/employees` (`directorateId`,
  `teamId`, `managerId` added; zod-bounded), still within the viewer's visibility scope.
- AC-4.2 Status chips with counts (one grouped count within the same scope and filters).
- AC-4.3 Salary hidden by default; entitled viewers turn the column on ("Show salary").
- AC-4.4 Placeholder IDs show a "Pending ID" chip.

## Scenarios

- Happy: HR opens a record → Overview summary; Edit ▾ → Employment & placement; Actions → Start
  leaver case pre-filled.
- Worst: a line manager without `people.viewPersonal` types `?tab=personal` → Overview, no data.
- Worst: an audit row's `changes` holds an encrypted salary diff → History says "basic salary"
  changed, by whom, when; no value.
- Worst: a manager filters by a company outside their chain → zero rows (scope still applies).

## Architecture

Page (server) → `components/people/record-view.tsx` (lists), `RecordHeader`, `RecordActions`
(client; dialogs made controllable via `hooks/use-controllable-open.ts`), `RecordPanel` switch,
`EmployeeHistory` ← `lib/people/history.ts`. Directory → `DirectoryFilters` on the new shared
`components/shared/FilterBar.tsx` (shadcn Select + chips), reused by later phases.

## Deferred

- "Raise ticket on behalf" — HR tickets are raised only through Siraaj today; there is no manual
  ticket-creation path to call. Needs a product decision.
- "Start joiner case" for an existing record — a joiner case is created together with the person.
