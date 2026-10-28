# JML task routing — IT and Finance desks, line-manager tasks (deferred P1-9)

Scope: lib/jml/routing/**, lib/validations/jml/routing.ts, lib/jml/access.ts, lib/jml/engine/**, lib/jml/work-items.ts, lib/jml/dashboard.ts, lib/jml/sweep.ts, lib/jml/join/activation.ts, lib/jml/leave/activation.ts, lib/jml/move/create.ts, lib/notifications/user-notify.ts, lib/nav/**, app/api/jml/config/task-routing/route.ts, app/api/jml/me/route.ts, app/api/jml/my-tasks/route.ts, app/api/employees/[id]/route.ts, app/[locale]/(dashboard)/jml/settings/task-routing/page.tsx, components/jml/**, prisma/seed-jml*.ts, tests/contracts/jml-routing.test.ts

Status: operator decisions recorded 2026-10-28 (overnight build brief). Source: UX review P1-9
(deferred from `ux-p1-jml.md`).

## Why

Every JML checklist task was owned by the case's HR owner. Laptop, access and email work is
IT's; payroll and the settlement payment are Finance's; welcoming a joiner or confirming a
handover is the line manager's. HR was relaying all of it by hand.

## Decisions (operator)

- **D1 — IT and Finance tasks go to NAMED PEOPLE** listed in a JML setting (Admin › Settings ›
  Joiners & leavers › Task routing; one list per desk, picked from Users, several each).
- **D2 — Desk tasks belong to the desk as a group** (decided by the build, per the brief): a
  desk task's owner is empty and reads "IT desk" / "Finance desk"; anyone on that desk may see and
  complete it; `completedBy` records who did. HR may still pin it to one person.
- **D3 — Empty desk → HR fallback.** When a desk has nobody at generation, the task is owned by
  the HR owner, and the case shows a setup warning while any such task is open. Filling the desk
  later makes the open tasks visible to the desk at once (visibility is by role, not owner).
- **D4 — Line managers get access automatically, no role.** The employee's line manager
  (`Employee.managerId` → that employee's `User`) may see and complete the LINE_MANAGER tasks on
  cases for their own direct reports only — derived at request time, the Performance rule
  (`lib/pms/permissions.ts`). No other task, no other case, no settlement or Restricted data.
- **D5 — Assignee role per template task**: HR | LINE_MANAGER | IT | FINANCE, copied onto the case
  task when tasks are generated and resolved to an owner then.
- **D6 — Manager changes mid-case**: open LINE_MANAGER tasks are re-assigned to the new manager
  (or the HR owner if there is none) and the new manager is notified. Authority follows the
  manager edge immediately; the stored owner is reconciled after the employee edit and, as a
  backstop for every other writer of `managerId` (import, roll-up, transfer, move), by the hourly
  JML sweep.

## Stories and acceptance criteria

- **US-1 (HR admin) configure the desks.** AC-1.1 The Task routing setting lists IT desk and
  Finance desk people, each picked from active users, up to 50 per desk; save replaces the list.
  AC-1.2 Only `jml.configure` at Group scope reads or writes it (403 otherwise).
- **US-2 (HR admin) route template tasks.** AC-2.1 The template editor shows an "Assigned to"
  select per task (HR, line manager, IT desk, Finance desk); saving cuts a new version as any
  edit does. AC-2.2 The seeded templates carry the mapping below.
- **US-3 (system) resolve at generation.** AC-3.1 JOIN, MOVE and LEAVE activation copy the role
  and set the owner per D2–D4. AC-3.2 After the case commits, each desk member and the manager
  get one bell notification per case ("N tasks on CASE-REF for NAME") linking to My tasks.
- **US-4 (desk user / manager) do the work.** AC-4.1 Their tasks appear in Home "My work" and on
  Joiners & leavers › My tasks (shown in the nav only when they have such work). AC-4.2 They may
  complete (with the confirmation trio when asked), progress, delay and comment on those tasks.
  AC-4.3 They may not change owner or due date, mark not applicable or re-open (403).
  AC-4.4 Completing records them as `completedBy`.
- **US-5 (HR) see the routing on the case.** AC-5.1 Each task row shows who it is for ("IT desk",
  "Finance desk", the manager's name). AC-5.2 A setup warning lists empty desks / a missing line
  manager while such a task is open, with a link to the setting.

## Worst paths

- A manager opens (or PATCHes a task on) another team's case → **404**, no existence leak.
- A desk user who has a task on a leaver case opens its settlement (or any other case tab or
  route) → **403** (they know the case exists; nothing more). A desk user with no task there → 404.
- A desk list is empty → the task falls back to the HR owner, and the case says so (US-5).
- The manager changes mid-case → open LINE_MANAGER tasks move to the new manager (D6); the old
  manager can no longer see or complete them; completed ones keep their `completedBy`.
- A desk user tries to set the owner/due date or mark N/A → 403 with the reason.
- A desk member's login is deleted → membership row cascades away.

## Data

- `JmlAssigneeRole` (HR, LINE_MANAGER, IT, FINANCE) on `jml_template_tasks` and `jml_tasks`
  (default HR — every existing row is unchanged); index `(assignee_role, status)`.
- `jml_desk_members (desk IT|FINANCE, user_id → users ON DELETE CASCADE, unique(desk,user))`.
- `NotificationKind.JML_TASK_ASSIGNED`, addressed to the login (`notifyUsers`).
- Migration `20261028101456_jml_task_routing` also back-fills the role onto the template rows
  already seeded in production (by template name + code + unchanged task name); the seed sets
  the same roles on fresh databases (`prisma/seed-jml-routing.ts`; a contract test keeps them
  equal).

## Template mapping (seeded)

| Template                            | Code  | Task                                                          | Role         |
| ----------------------------------- | ----- | ------------------------------------------------------------- | ------------ |
| Standard onboarding                 | T20   | Welcome employee                                              | LINE_MANAGER |
| Standard onboarding                 | T22   | Hand over laptop                                              | IT           |
| Standard onboarding                 | T23   | Confirm credentials shared                                    | IT           |
| Standard onboarding                 | T24   | Confirm access card issued                                    | IT           |
| Standard onboarding                 | T40   | Add employee to payroll sheet when Payroll Applicable = Yes   | FINANCE      |
| Standard onboarding                 | T43   | Add employee to employee distribution list                    | IT           |
| Internship to training              | T20   | Add employee to payroll sheet                                 | FINANCE      |
| Internship to training              | T21   | Agree training plan with line manager                         | LINE_MANAGER |
| Internship / Training to employment | T20   | Add employee to payroll sheet                                 | FINANCE      |
| Department transfer                 | T20   | Update employee distribution lists                            | IT           |
| Department transfer                 | T21   | Complete handover from previous department                    | LINE_MANAGER |
| Offboarding Full + Light            | S1-05 | Execute immediate access revocation and asset recovery        | IT           |
| Offboarding Full + Light            | S1-07 | Line Manager and management confirm the exit                  | LINE_MANAGER |
| Offboarding Full + Light            | S3-02 | Confirm handover completion with the line manager             | LINE_MANAGER |
| Offboarding Full + Light            | S3-04 | IT confirms access revocation complete                        | IT           |
| Offboarding Full + Light            | S3-05 | IT confirms shared and service credentials rotated            | IT           |
| Offboarding Full + Light            | S3-06 | Confirm company asset return to IT                            | IT           |
| Offboarding Full + Light            | S3-07 | Disable the email account (IT confirms)                       | IT           |
| Offboarding Full + Light            | S3-08 | Remove from email distribution lists (IT confirms)            | IT           |
| Offboarding Full + Light            | S3-09 | Mailbox and file disposition                                  | IT           |
| Offboarding Full + Light            | S4-06 | Confirm settlement payment executed, record payment reference | FINANCE      |

Left with HR on purpose: "Submit IT request", "Instruct IT to …", "Add employee to the IT
offboarding list", "Instruct Finance to …", "Send … to Finance" (HR is the one instructing);
orientation, office tour, welcome email and the joiner's introduction (HR-run); S3-01
confidentiality review (HR leads it, with the manager). The Finance desk confirms S4-06 with the
payment reference only — it never sees settlement figures.

## Architecture

- `lib/jml/routing/rules.ts` — pure: owner resolution, warnings, derived authority, the
  worker field allow-list.
- `lib/jml/routing/desks.ts` — desk settings service; `lib/jml/routing/assign.ts` — routing
  context, assignment notices, manager reconciliation; `lib/jml/routing/worker.ts` — the
  derived-worker loader used by the task engine and the work lists.
- `lib/jml/access.ts` `loadCaseFor` answers 403 (not 404) to someone with a routed task on the
  case — so every existing case route refuses a desk user with 403, settlement included.
- The task engine (`loadTaskForWork`, comments) falls back to derived authority when the actor
  lacks `jml.workTasks` in scope, and then applies `workerChangeProblem`.

## Open questions

- None blocking. Notifications are in-app only (email needs SMTP, see the morning notes).
