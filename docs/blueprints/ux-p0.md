# UX review P0 fixes — one inbox, one leaver process, no dead ends

Scope: lib/core/**, app/api/work-items/**, app/api/leavers/**, app/api/transfers/**, lib/hiring/**, lib/hive/**, lib/jml/**, lib/pms/**, lib/notifications/**, app/api/hiring/**, app/api/hive/**, app/api/notifications/**, app/[locale]/(dashboard)/page.tsx, app/[locale]/(dashboard)/settings/page.tsx, app/[locale]/(dashboard)/admin/edge-cases/page.tsx, app/[locale]/(dashboard)/people/[id]/page.tsx, prisma/schema.prisma, prisma/migrations/**, prisma/seed.ts, prisma/seed-foundation.ts

Status: approved by the operator (Tariq) on 2026-10-27 — "build all P0 items, merge and deploy".
Source: the HR Centre UX review (shell/people R1–R6, performance/JML P0-1..P0-4,
tickets/hiring P0-1..P0-5). Every claim was re-checked against `main` at 695a199 before building.

## Why

The merge produced one login but not yet one product. Home claims to list "everything waiting on
you" and lists only Performance and ticket work. A leaver can be recorded without the exit process.
An offer can be sent to an approval step nobody holds and stall silently. Nationality sits under
every candidate's name. Modules a user has no role for are invisible, so the operator could not find
Hiring. Spec section numbers (§5.1) and enum codes (ROP_CLEARANCE) leak into the UI.

## Stories and acceptance criteria

### US-1 — One "My work" list on Home

As anyone with work in any module, I see it in one list on Home.

- AC-1.1 A provider registry (`lib/core/work-items`) collects items from JML (open tasks I own,
  approvals I can decide), Hiring (requisition / JD / offer approvals awaiting me, scorecards I owe,
  rejection notices to send) and HR tickets (answers to draft and approve in my pairs). Performance
  items (KPI sets, 360s, year-end) are built from the same task logic the Home card already used and
  merged into the same list.
- AC-1.2 Every provider is permission-checked with the module's own rules and is bounded (≤ 20 rows
  per provider, plus a total count). A provider that fails is reported as "couldn't load X", never
  silently dropped.
- AC-1.3 Home renders ONE list grouped Overdue / This week / Later, each row with a module chip, a
  title, a due label and a link. Empty: "Nothing is waiting on you."
- AC-1.4 The subtitle claims only what the list contains.

### US-2 — One leaver / mover process

- AC-2.1 "Record departure" on the person record opens a pre-filled new JML leaver case
  (`/jml/leavers/new?employeeId=`), not a direct departure.
- AC-2.2 Performance's "Leavers & transfers" page is renamed "Roll-ups & split years"; its
  leaver and transfer forms open the JML leaver / mover case instead of recording directly.
- AC-2.3 `POST /api/leavers` and `POST /api/transfers` require an explicit
  "record without exit process" reason and the HR Super Admin role (people.edit + perf.configure at
  Group scope); the reason is written to the audit log. Imports keep their own path.
- AC-2.4 Closing a JML leaver case still applies the Performance consequences (`applyDeparture`).

### US-3 — No dead-end approvals

- AC-3.1 Submitting an offer for approval is refused (409) while any chain step has no holder; the
  error names the step. The UI disables "Submit for approval", names the step and links to
  Admin → Roles.
- AC-3.2 The same check guards requisition submission (create-and-submit and status change) and
  JD submission (at least one HR sign-off holder other than the submitter).

### US-4 — Sensitive candidate data

- AC-4.1 The candidate list sub-line shows current employer / role, never nationality.
- AC-4.2 Gender, national ID, nationality, ethnicity / diversity fields and expected salary are
  in a separate "Sensitive" section on the profile, shown only with `hiring.viewPii` (expected
  salary keeps its comp gate).
- AC-4.3 A panelist without `hiring.viewPii` receives none of those fields from any candidate API;
  contract tests pin it.

### US-5 — Every module discoverable; first admin has full access

- AC-5.1 The "HR Centre" switcher lists People, Performance, Joiners & leavers, Hiring and HR
  tickets. Accessible modules link; the rest say "No access — ask a platform administrator", and a
  platform admin gets a link to Admin → Roles.
- AC-5.2 A one-time migration gives the bootstrap admin (the `BOOTSTRAP-ADMIN` employee's login)
  each module's admin starter role at Whole group; a fresh install's bootstrap does the same once.
  Re-deploys never re-grant a role an admin removed.

### US-6 — Bell notifications for Hiring and HR tickets

- AC-6.1 New kinds: approval requested of you (requisition, JD, offer), offer approved / rejected,
  scorecard due, ticket to draft in your pair, ticket awaiting your approval, answer returned to you.
- AC-6.2 A notification may target a User when there is no Employee record.
- AC-6.3 No Restricted data in a notification: no salary, no ID numbers; ticket text at most a
  short preview.

### US-7 — Wording clean-up

- AC-7.1 No `§` in `messages/en.json` (contract test); none in the Performance refusal reasons
  shown on Home.
- AC-7.2 Compliance categories show as words ("ROP clearance"), not codes.
- AC-7.3 A blocked task shows its reason and who to contact, with no action button.
- AC-7.4 The template Settings stub leaves the nav; `/settings` goes to Profile.
- AC-7.5 Login panel describes HR Centre.
- AC-7.6 "Refuse" on a candidate is a secondary destructive button behind a dialog that requires a
  reason; a primary "Move to <next step>" button sits beside it.

## Scenarios

Happy: Noura (Junior HR) opens Home and sees three overdue JML tasks, one ticket to answer and her
own year-end self-assessment, grouped by due, each with a chip and a link.
Happy: HR clicks "Record departure" on a record and lands in a new leaver case with the employee and
last working day filled in; closing the case later rolls up the reports and revokes the login.
Worst: an offer's chain needs a COO and nobody holds COO — the submit button is disabled with
"COO: nobody holds this role — assign one in Admin → Roles", and a crafted PUT gets 409.
Worst: a panelist calls `GET /api/hiring/candidates/:id` — gender, national ID, nationality and
expected salary are absent from the JSON.
Worst: one provider's query throws — Home still shows the other modules' work and says which module
could not load.
Worst: an admin removes the operator's Hiring admin role — the next deploy does not give it back.

## Architecture

- `lib/core/work-items/` — `WorkItem` type, provider registry, `collectWorkItems(userId)` with
  per-provider try/catch and bounds; providers live beside their modules (`lib/jml/work-items.ts`,
  `lib/hiring/work-items.ts`, `lib/hive/services/work-items.ts`). Read by `GET /api/work-items`.
- Hiring vacancy check: `vacantSteps()` in `lib/hiring/approval-config.ts`, used by
  `offer-write`, `offer-versions`, `requisition-status`, `requisition-write`, `jd`.
- Notifications: `Notification.recipientEmployeeId` becomes nullable and `recipientUserId` is added
  (exactly one set, CHECK constraint); `module` column; new kinds. Writers in
  `lib/notifications/write.ts`.
- Bootstrap grant: migration `ux_p0_bootstrap_admin_roles` + seed step after module seeds.

## Open questions

- None blocking. Arabic strings stay as placeholders (operator: English only).
