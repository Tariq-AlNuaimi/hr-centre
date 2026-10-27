# UX review P1 — phase 6: the Joiners & leavers case, at a glance

Scope: lib/jml/engine/case-read.ts, lib/format.ts, components/jml/**, tests/contracts/ux-jml-case.test.ts

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1".
Source: UX review performance/JML P1-3, P1-4, P1-5 (+ the JML half of P1-6). Re-verified on
`main` at 8d5ba31 (after the QA fixes in #43).

## Why

A case opened on a 21–38-row checklist, each task a full-width card with about six controls,
under eight equal-weight header buttons (destructive beside routine). A leaver case had ten tabs.
The computed risk flag (`ragFlag`) was never shown; the list had no key date for leavers, no
overdue or next-due signal and was not on the shared table. Dates were ISO strings.

## Stories and acceptance criteria

- AC-1 (P1-3a) A summary strip above the tabs: the type's key dates (planned / actual start;
  effective date; notice start, last physical day, last day of service), HR owner, risk, the next
  task due (code + relative date), overdue and open-blocking counts.
- AC-2 (P1-3b) ONE primary action by state (JOIN: confirm actual start until day one; LEAVE:
  close the exit when allowed), then "More actions": routine (change start, IT readiness, submit
  to IT, record Odoo ID, reassign owner, archive) and, separated under "Protective or
  irreversible", cancel / withdraw exit / legal hold. Same dialogs, same routes.
- AC-3 (P1-3c) A task row is one line: code + name, flags, relative due date, owner; one
  "Complete" button; "More" reveals set-status, delay, not applicable, due date, owner. No
  duplicate status control.
- AC-4 (P1-3d) Each stage shows "N open · N done"; settled tasks fold into "N done"; filter chips
  All / Mine / Overdue / Blocking with counts over the open tasks.
- AC-5 (P1-3e) Due dates read "3 days overdue", "Due today", "Due in 4 days" (calendar date on
  hover); one shared day formatter (`formatDay`, UTC so a calendar day never shifts) and no
  seconds in date-times.
- AC-6 (P1-4) Tabs: leaver Checklist · Overview (overview, approvals, compliance) · Exit
  (interview, settlement) · Documents & access (documents, assets & access) · Activity (activity,
  emails); joiner 4, mover 3. The Checklist tab shows its open-task count. Old `?tab=` links land
  on the tab that now holds their panel.
- AC-7 (P1-5) The case list sorts riskiest first (RED, AMBER, GREEN, then newest); columns
  Case · Employee · HR owner · Key date (per type) · Risk (+ overdue tasks) · Next due · Stage ·
  Status; overdue counts and next due come from two grouped reads over the page (never one per
  case). On the shared `DataTable` + `FilterBar` (shadcn Selects).

## Deferred to slice 6b (same phase)

P1-9 — template tasks with an assignee role (LINE_MANAGER, IT, FINANCE, HR) resolved at
generation, and a narrow `jml.workOwnTasks` permission so non-HR owners see and work their tasks.
Needs a migration, generation changes and a change to who may update a task.

## Scenarios

- Happy: HR opens a leaver case → strip shows "Last day of service 30 Nov 2026 · Off track · Next
  due S2-03 · 2 days overdue"; Checklist shows open work, "7 done" folded.
- Worst: a case with no dated tasks → "Nothing due"; a JOIN without IT readiness rights → no
  "More actions" button at all.
