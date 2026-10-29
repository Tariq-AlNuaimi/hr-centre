# P2 — Employee "Me" area and the navigation persona flag

Scope: lib/people/me.ts, lib/nav/config.ts, lib/nav/resolve.ts, lib/nav/server-context.ts, components/layout/use-nav-context.tsx, app/[locale]/(dashboard)/me/requests/page.tsx, app/[locale]/(dashboard)/me/documents/page.tsx, messages/**, tests/contracts/p2-me.test.ts, tests/contracts/ux-nav.test.ts

Status: operator-approved P2 roadmap (2026-10-29). Source: UX audit `shell-people.md` R22 and
`tickets-hiring.md` P2-11 ("My HR questions"). Benchmarks: BambooHR / HiBob employee "Me" pages,
Zendesk "My requests".

## Stories and acceptance criteria

- **US-1 (any employee with a login) my own HR self-service.** AC-1.1 The Me group holds My profile,
  My performance ("My year", P2-2) and "My HR" with two tabs: My requests and My documents. AC-1.2
  My requests lists the HR questions I raised (by my employee id, or my login email for tickets
  raised before my record was linked), newest first, ≤ 50: ticket id, my question, asked date and an
  employee-facing state (With HR / Answered / Closed) with the answered date. No draft, internal
  note, drafter, approver or assignee is read. AC-1.3 My documents shows my Civil ID and passport
  expiry dates (never the numbers, which stay encrypted and HR-only) and the goal evidence I
  attached (opened through the existing evidence read route), and says letters are requested
  through HR. AC-1.4 The pages read only the caller's own record: no id or query parameter exists.
- **US-2 (all) HR tools hidden from the employee persona.** AC-2.1 The navigation context carries a
  `persona` flag: "staff" when the viewer holds any HR, manager, hiring, ticket, JML or admin
  capability; otherwise "employee". AC-2.2 Every HR tool entry (team, talent, service, insights,
  admin groups and JML) is marked staff-only and the resolver drops it for the employee persona —
  a second gate on top of each entry's own permission check, so one mistakenly open gate does not
  reach an employee. The employee persona sees Home, Me and People (directory and org chart, both
  already scoped by §4.2).

## Worst paths

- Login not linked to an employee record → "Your account is not linked yet", nothing is read.
- No tickets / no evidence / no expiry on file → honest empty states.
- ADR-087's 17-entry sidebar becomes 18 for a full-access user (one "My HR" entry with two tabs).

## Data

None new.
