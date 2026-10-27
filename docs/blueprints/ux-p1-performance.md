# UX review P1 — phase 7: a cycle console and a calmer goal-setting list

Scope: lib/pms/cycle-overview.ts, app/api/cycles/[id]/overview/route.ts, app/api/cycles/[id]/remind/route.ts, app/api/cycles/[id]/participants/route.ts, app/[locale]/(dashboard)/admin/cycles/**, app/[locale]/(dashboard)/goal-setting/page.tsx, components/pms/**, lib/validations/cycle.ts

Status: approved by the operator (Tariq) on 2026-10-27 — "build all of P1".
Source: UX review performance/JML P1-7 and P1-8. Re-verified on `main` at 6838e2c.

## Why

The cycle console is one table row with four equal buttons: no stage timeline, no completion per
stage, no "who is late", no reminder action (Lattice's progress tab has all four). The
goal-setting roster repeats the same locked-stage sentence on every row (37×), has an "Actions"
column holding the same button on every row, no state filter, and every KPI shows the full
five-level rubric (~450px each).

## Stories and acceptance criteria

- AC-1 (P1-8) Each cycle's year opens `/admin/cycles/<id>`: the three stages as a timeline
  (opens, deadline, grace, Not open yet / Open / Locked), completion % and "N of M done" for goal
  setting and year-end (from the same status engine as the roster), and the number of people late
  once a deadline has passed (settled and not-applicable sets are not late).
- AC-2 (P1-8) "Remind late" on a late stage of an OPEN cycle: one in-app reminder to each person
  who owes the next step (manager while drafting or awaiting the manager; employee when awaiting
  the employee; HR's own queue is not nudged), at most once per person, stage and day (dedupe key
  carries the date). HR who may run the cycle only; rate-limited 10/min.
- AC-3 (P1-8) A setup checklist: stage windows scheduled, employees enrolled, corporate or
  departmental scores entered, calibration targets set — each with a link to where it is done.
- AC-4 (P1-7) The roster says the reason most rows share once above the table; a row repeats a
  reason only when it differs. The name links to the set; the Actions column is gone.
- AC-5 (P1-7) A state filter (Not drafted / Awaiting manager / Awaiting employee / Awaiting HR /
  Approved), applied server-side so pages and totals stay honest; it replaces the one-number
  "People you can see" card.
- AC-6 (P1-7) A KPI's five rating descriptors fold into "Rating descriptors (5 levels)".
- The bell heading for `CYCLE_REMINDER` reads "Performance deadline approaching" (it now also
  carries year-end reminders).

## Scenarios

- Happy: HR opens 2027 → goal setting Locked, 92%, "3 people late — see who", Remind late →
  "Reminded 3 people"; pressing again the same day → "Everyone late was already reminded today".
- Worst: an HRBP without org-wide sight… still runs the cycle (§4.1); a line manager → 403, the
  console says it cannot be loaded.
