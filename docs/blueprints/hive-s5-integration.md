# Blueprint — HR tickets slice 5: tickets inside the rest of HR Centre

Scope: components/hive/**, lib/hive/services/**, app/[locale]/(dashboard)/page.tsx, app/[locale]/(dashboard)/people/[id]/page.tsx, components/people/RecordTabs.tsx, app/[locale]/(dashboard)/hive/**

Status: part of `docs/blueprints/hive.md` (slice 5, US-H10).

## What this slice delivers

- Home → My tasks: an "HR tickets" panel for anyone who drafts or approves — submitted answers
  (and failed sends) waiting for THEIR approval in the pairs they cover, never their own draft;
  open and reopened tickets waiting for an answer in pairs they draft for. Counts plus the five
  oldest of each, linked to the ticket.
- Employee record → "HR tickets" tab (`?tab=tickets`): the person's tickets matched by work email
  (`Escalation.employeeId`), with an "unverified" note when Siraaj did not confirm the identity.
  Shown only with `tickets.see`; without it the tab is absent and the URL shows the overview.
- Ticket detail: the asker's email, whether Siraaj confirmed it, and a link to the employee record.

## Worst paths checked

A viewer with people access but no `tickets.see` opening `?tab=tickets` (overview, no question
shown); an approver whose own draft is pending (not listed for them); a person with no ticket
role (no panel, no queries).
