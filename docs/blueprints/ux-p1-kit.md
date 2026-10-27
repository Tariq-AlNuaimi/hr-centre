# UX review P1, phase 10: one visual kit across JML and Hiring

Scope: components/jml/**, components/hiring/**, lib/format.ts

Status: approved by the operator (Tariq) on 2026-10-27 ("build all of P1").
Source: UX review P1-11 (hiring half) and the "one visual kit" line of the P1 brief.
Re-verified on `main` at 64007b7.

## Why

List screens in JML and Hiring each built their own controls:

- filter rows from bare native selects with only an aria-label (no visible label);
- a hiring-private copy of the filter chips;
- a hand-rolled offers table with its own pager;
- ad-hoc date formats (`2026-12-01` on the employee's hiring tab, a locale timestamp with seconds
  in JML settings).

## Stories and acceptance criteria

- **AC-1: Filters.** Every list-screen filter uses the shared kit
  (`components/shared/FilterBar`):
  - **FilterChips** for small exclusive choices: phase, status, view, mine/all, case type.
  - **FilterSelect**, a shadcn/Radix Select with a visible label, for long lists: company,
    department, requisition, owner, source, status.

  Screens covered:
  - Hiring: candidates, requisitions, interviews, offers, evaluations, screening, close-out.
  - JML: joiners, calendar, statutory, my tasks, dashboard.

- **AC-2: One chip component.** The hiring-private `FilterChips` is deleted. One component, one look.
- **AC-3: Offers table.** The offers list uses the shared `DataTable`, with pagination and an
  honest empty state through `EmptyState`.
- **AC-4: One date style.**
  - Dates read as the medium style from `lib/format.ts`.
  - A start date stored at local midnight is shown with `formatZonedDay` (Muscat), so it never
    reads as the previous day.
  - Internal `en-CA` formatters that build date-input values (`YYYY-MM-DD`) are not display and
    stay as they are.

## Decision: forms keep the shared NativeSelect

Form fields (joiner, mover, requisition, offer and settings dialogs) keep
`components/org/NativeSelect`. It is already the shared primitive. It submits a value through
native form semantics, works with `required` and native validation, and behaves well on mobile.
Rewriting about 90 form fields to Radix Select would be churn with no user-visible gain.

The kit rule is:

- filters use FilterChips or FilterSelect;
- form fields use NativeSelect.

The report filter panels (draft filters with an Apply button) are forms, so they keep NativeSelect.

## Worst paths

- **Radix Select cannot hold an empty value.** FilterSelect maps "All" to a sentinel, so `""`
  still means "no filter" to every caller.
- **Filter changes reset to page 1,** as before.
