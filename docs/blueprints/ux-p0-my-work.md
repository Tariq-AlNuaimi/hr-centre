# UX review P0 — one "My work" list on Home (slice E)

Scope: lib/core/work-items/**, lib/jml/work-items.ts, lib/hiring/work-items.ts, lib/hive/services/work-items.ts, app/api/work-items/route.ts, components/home/**, components/pms/MyTasksOversight.tsx, app/[locale]/(dashboard)/page.tsx

Parent contract: `docs/blueprints/ux-p0.md`, US-1.

## Stories

- As anyone with work in any module, I open Home and see one list of what is waiting on me,
  grouped Overdue / This week / Later, each row with its module and a link.
- As an HR officer, my Joiners & leavers checklist tasks are on Home (they used to be only at
  `/jml/my-tasks`).
- As an approver or panelist, my Hiring approvals and scorecards are on Home.

## Acceptance criteria

- AC-W1 Providers: JML (tasks I own on live cases; approval decisions to record where I hold
  `jml.decideApprovals` in scope), Hiring (requisition / offer approvals whose next step I may
  decide as a role holder, JD sign-offs I may give, scorecards I owe for past interviews, rejection
  notices ready to send), HR tickets (answers to approve / tickets to answer in my pairs).
  Performance joins on the client from the Performance reads and ranking.
- AC-W2 Each provider is bounded to 20 items and returns its true total; the UI says when a module
  is capped.
- AC-W3 A provider that fails is named in the UI ("Couldn't load your work from: Hiring"), the rest
  still render; never "Nothing is waiting on you" over a failure.
- AC-W4 A blocked Performance task shows its reason and who to contact, with no action button.
- AC-W5 The list's subtitle names exactly the modules it reads.

## Scenarios

Happy: Noura owns six overdue leaver tasks and one ticket to answer — Home shows "Overdue (6)" with
the JML chip and "Later (1)" with the HR tickets chip; each opens the case or ticket.
Worst: the Hiring provider throws — JML and tickets still show; a red line names Hiring with
"Try again".
Worst: a hiring admin with no approval role — no company-wide flood of approvals; only steps whose
role they hold.

## Architecture

`GET /api/work-items` (withAuth + rate limit, no parameters) → `collectWorkItems(session,
providers)` → `Promise.allSettled` over providers → items sorted by due. The client merges
Performance tasks (`usePmsTasks`) and renders `components/home/MyWork.tsx`.
