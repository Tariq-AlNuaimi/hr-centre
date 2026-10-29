# Overnight small items — raise on behalf, answer-by setting, start joiner, unit heads, QA lows, pmsRoles

Scope: lib/validations/messages.ts, lib/validations/employee.ts, lib/validations/org.ts, lib/validations/hive/**, lib/validations/jml/joiner.ts, lib/hive/services/**, lib/hive/tools/orgchart.ts, lib/org/heads.ts, lib/jml/join/open-join.ts, lib/jml/leave/settlement-rules.ts, lib/pms/permissions.ts, lib/pms/employee-select.ts, lib/pms/org-chart.ts, lib/api-response.ts, lib/rbac/**, app/api/hive/escalations/route.ts, app/api/hive/employees/route.ts, app/api/org/heads/route.ts, app/api/org/\*/route.ts, app/api/jml/joiners/from-employee/route.ts, app/api/users/route.ts, app/[locale]/(dashboard)/tickets/(queue)/new/page.tsx, app/[locale]/(dashboard)/tickets/(queue)/page.tsx, app/[locale]/(dashboard)/tickets/setup/settings/page.tsx, app/[locale]/(dashboard)/tickets/setup/(config)/org-details/page.tsx, app/[locale]/(dashboard)/people/[id]/page.tsx, app/[locale]/(dashboard)/people/(list)/page.tsx, app/[locale]/(dashboard)/page.tsx, components/**, prisma/schema.prisma, prisma/migrations/20261029102306_small_heads_tickets_pms_roles/**, prisma/seed.ts, prisma/seed-pms.ts, prisma/seed-demo-cycle.ts, prisma/seed-hive.ts, messages/**, tests/**

Status: operator-approved overnight item 2 (2026-10-28 brief). Sources: QA report 2026-10-27
(D-15, D-16, D-17), UX reviews (shell-people R10/R13/R18, tickets P1-2/P1-5).

## Stories and acceptance criteria

- **US-1 (HR Drafter) raise a ticket for an employee.** AC-1.1 A user holding `tickets.draft` on
  any pair sees "Raise a ticket" on the queue and "Raise HR ticket for this person" in an
  employee's Actions menu (not for leavers). AC-1.2 The form picks an employee (name, work email,
  company — up to 20, leavers and placeholder emails excluded) and takes the question (5–2000
  characters). AC-1.3 The ticket is the employee's: record name/email, routed by their company and
  directorate/department through the normal rules, OPEN, source "Raised by HR", `raisedById` set,
  history line "Raised by HR (<name>) for <employee>". AC-1.4 Approval is unchanged — the raiser
  gains nothing; the existing self-approval rule applies to whoever drafts. AC-1.5 Worst paths:
  unknown/leaver → 404; no work email yet → 422; same question within 30 min → 409; over three in
  an hour → 429; no HR pair → 503; no Draft permission → 403 (route) / 404 (page).
- **US-2 (ticket admin) set the answer-by target.** AC-2.1 Admin › Settings › HR tickets ›
  Settings has "Answer-by target" in working hours (1–400, default 16), saved with the prefix and
  labels; reset returns it to 16. AC-2.2 New tickets' due time uses it; existing tickets keep theirs.
- **US-3 (HR) start a joiner case from the record.** AC-3.1 A PRE_JOINER with no live onboarding
  shows "Start joiner case" in Actions to a viewer with Manage joiners for that placement; it opens
  a DRAFT joiner case and goes to it. AC-3.2 Out of scope → 404; not a pre-joiner or a live case
  exists → 409 with a sentence.
- **US-4 (org admin) unit heads.** AC-4.1 Companies, directorates, departments and teams each have
  an optional head, set/changed/cleared in Organisation structure (active employees only; a leaver
  is refused). AC-4.2 The org chart shows "Head: Name" on companies and departments. AC-4.3 HR
  tickets' org-structure tool reports the head's name and job title as the unit leader; the
  Org-chart details page keeps display order only and shows the head read-only. AC-4.4 HIVE's
  free-text leader names became heads where the name matched exactly one current employee;
  otherwise blank (the old text is kept read-only and shown as "previously listed").
- **US-5 (everyone) QA lows.** AC-5.1 (D-15) No zod type-checker text ("Too small: expected
  string…") reaches a person; schema-specific messages still win; the settlement gate no longer
  prints "()". AC-5.2 (D-16) An out-of-scope person page answers HTTP 404. AC-5.3 (D-17) A
  department/directorate name repeated across companies reads "Sales · Rihal" in filters.
- **US-6 (platform) drop `Employee.pmsRoles`.** AC-6.1 Nothing reads or writes it (lib, app,
  components, seeds, scripts, fixtures, tests); demo/fixture HR authority comes from role
  assignments. AC-6.2 The column and the `PmsRole` enum are dropped; the 20261026180000
  conversion is not repeated.

## Decisions

- D16 fix: the route-level loading boundary moved from `(dashboard)/loading.tsx` to each section
  (and `people/(list)/`), because a boundary above `people/[id]` streams it and `notFound()` then
  answers 200. Home keeps a skeleton via its own Suspense.
- Heads need not belong to the unit (a director may be on another company's payroll); only "is a
  current employee" is enforced. A departed head is hidden on the chart and in the tool, flagged
  in Organisation structure.
- The employee picker for raising tickets returns name, work email and company to any Drafter,
  group-wide — the same identity data a ticket already carries.

## HIVE leader names to set as heads (from the HIVE seed; production had no matching employees)

Rihal directorates: Operations — Tariq Al Nuaimi (Director); Commercials — Mohammed Al Ghaithi
(Director); Products — Zainul Abedeen (Director); Data Engineering & Analytics — Ahmed Al
Ghusaini (Acting Director); Technology & Development — Ahmed Al Hasani (Director); Strategy —
Sadiq Damani (Director); Digital Transformation & AI — Mohammed Suwaid (Manager); Digital Trust &
Resilience — Maiysa Al Dhanki (Manager); ERP & Digital Innovation — Amin Elimam (Manager).
TP departments: Commercials — Mohammed Al Ghaithi (Commercial Director); Operations — Sultan Al
Masroori (Operation Manager); Project & Change Management — Abdulmalik Al Rawahi (Manager).

## Data

Migration `20261029102306_small_heads_tickets_pms_roles`: `EscalationSource.HR`,
`hive_escalations.raised_by_id`, `head_employee_id` on `org_entities`/`directorates`/
`departments`/`teams` (SET NULL, indexed), the unique-name leader → head back-fill, and
`DROP COLUMN employees."pmsRoles"` + `DROP TYPE "PmsRole"`.
