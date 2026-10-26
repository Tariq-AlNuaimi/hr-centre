# ADR-077 — One working calendar (schedule + public holidays)

**Status:** 🟢 Accepted — operator brief for the JML module, 2026-10-26.
**Date:** 2026-10-27
**Related:** `docs/blueprints/jml.md` D3; `lib/working-time/calendar.ts`.

## Context

HR Onboarding stored a `WorkingSchedule` (JS weekdays, hours, zone) that only its email window
read — due dates hard-coded Fri/Sat (port defect 8.4.4). HR Offboarding stored ISO weekend days
plus notify hours that its notification code never read, and evaluated the window in UTC, so the
09:00-Muscat cron never delivered anything (F2). Neither knew public holidays.

## Decision

One core `WorkingSchedule` singleton (ISO weekdays Mon=1…Sun=7, default Sun–Thu; 08:00–17:00;
`Asia/Muscat`) and a core `PublicHoliday` table. `lib/working-time/calendar.ts` is the only
place working days are computed: a non-working day is a weekend day of the schedule or a
holiday; both source semantics are kept as named functions (`addWorkingDays` — Offboarding,
`addCalendarDaysRolled` — Onboarding); windows are evaluated in the schedule's zone through Intl.
Changing the schedule or holidays affects future calculations only — stored due dates never move.

## Considered options

1. **Core schedule + holidays (chosen).**
2. **Keep per-module schedules** — rejected: the two disagreed in numbering and in effect.
3. **A date library (date-fns-tz / Luxon)** — rejected: Intl already gives correct zone
   conversion and the working-day rules are bespoke (holidays, snap-forward).

## Consequences

ISO numbering everywhere; tests pin Fri/Sat as the default weekend and Muscat-time windows.
