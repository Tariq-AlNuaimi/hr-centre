# Blueprint — JML slice S7: dashboard, my tasks, the employee-record tab

Scope: lib/jml/dashboard.ts, lib/jml/dashboard-rules.ts, lib/jml/employee-tab.ts, lib/validations/jml/**, app/api/jml/dashboard/**, app/api/jml/my-tasks/**, components/jml/**, app/[locale]/(dashboard)/jml/**, app/[locale]/(dashboard)/people/[id]/page.tsx, components/people/RecordTabs.tsx, components/pms/NotificationList.tsx, components/layout/NotificationsMenu.tsx, hooks/use-notifications.ts, tests/contracts/jml-dashboard.test.ts, tests/contracts/hive-my-tasks.test.ts

Status: part of `docs/blueprints/jml.md` (slice 7, the last). Sources: HR Onboarding's dashboard
and "My tasks"; HR Offboarding Module 11 (AC-13.1, AC-13.5) and its notification inbox.

## What this slice delivers

- **Dashboard (`/jml`):** live joiners/movers/leavers, joining and leaving this month, average
  completion; my work (open tasks I own, bucketed overdue / today / tomorrow / later); delayed
  tasks; approvals awaiting a decision (oldest first); statutory watch (joiners' statutory tasks
  and expatriate leavers' visa cancellation within three working days or breached); this month's
  exit reasons by category. Every panel capped at 50 and scoped; a case owner sees their own
  cases by default and can widen to everything they may see (AC-13.5); a supervisor sees all.
- **My tasks (`/jml/my-tasks`):** every open task I own, by bucket, filterable by case type —
  where the overdue digest links.
- **Employee record tab:** "Joiners, movers & leavers" — the person's cases, assets they still
  hold and access granted; present only for someone who may see JML cases for that placement
  (one cheap check per record view; the data loads only when the tab is open).
- **Notification bell:** JML notices render (the icon map had no JML kinds — the bell would have
  thrown on the first one) and every notice can be dismissed (the S2 route had no button).

## Scenarios

- Happy: a Junior HR owner lands on `/jml` and sees their three overdue tasks first; a Senior HR
  sees every case in their scope and the pending Final Settlement signatures.
- Worst: an officer with no JML role opens a person's record — no JML tab, and `?tab=jml` shows
  the overview.
