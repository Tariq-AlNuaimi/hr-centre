# P2 — Performance: My year, rating context with autosave, working-day grace

Scope: lib/pms/stage.ts, lib/pms/compliance.ts, lib/pms/year-end-select.ts, app/api/pms/my-year/route.ts, app/api/internal/cycle-sweep/route.ts, app/[locale]/(dashboard)/scorecard/page.tsx, app/[locale]/(dashboard)/year-end/[cycleId]/participants/[participantId]/page.tsx, components/pms/**, messages/**, tests/contracts/p2-performance.test.ts, tests/contracts/pms-cycle.test.ts, tests/contracts/pms-signoff.test.ts

Status: operator-approved P2 roadmap (2026-10-29); second slice of `p2-performance.md`. Source: UX
audit `performance-jml.md` P2-2, P2-3, P2-9. Benchmarks: Culture Amp's employee review guide and
questions-left / context-right form; BambooHR / Lattice "my reviews" home.

## Stories and acceptance criteria

- **US-4 (employee) a performance home all year.** AC-2.1 `GET /api/pms/my-year?cycleId=` returns
  the caller's OWN participant only (looked up by the session's employee id; no id parameter):
  stage dates and state, KPI set with weights, HR approval date and mid-year change
  requests. It returns no score, band or 360 (§13.1 / §13.2 stay on `/api/scorecard`). AC-2.2 The
  scorecard page (renamed "My year") shows dates, goals with a weight total, and mid-year changes
  above the results; "results are not out yet" is a calm note, not the whole page.
- **US-5 (employee, manager) rate with the context at hand.** AC-2.3 Each KPI on the year-end
  assessment is two columns: the descriptors as choices on the left, and on the right the latest
  APPROVED mid-year change to that KPI (rationale, decision, date) and the evidence. HR viewers
  also get the consolidated 360 card at the top; managers do not (§9.8 keeps 360 reports with HR).
  A complete draft autosaves after 1.5 s through the same route as Save, with a status line
  ("Saving…", "Saved", "Not saved"). Mid-year itself has no rating form (it is a change-request
  stage), so the panel lives on year-end; mid-year's context is shown on My year.
- **US-6 (HR) grace on the real calendar.** AC-2.4 Stage grace days are working days on the core
  calendar (working week + public holidays, ADR-077); the deadline's time of day is kept; zero
  grace ends at the deadline. The cycle sweep loads the calendar once per run.

## Worst paths

- Account not linked to an employee → 403 with the ADR-065 sentence; unknown cycle → 404; not
  enrolled → "You are not part of the {year} cycle".
- Autosave against a locked stage or a missing divergence reason → the server refuses, the status
  says "Not saved" and the blocked banner shows the reason; nothing is retried in a loop.
- A grace window across Eid → the holidays are skipped, so HR's intervention is not due early.

## Data

None new. Reads `CycleParticipant` (own), `Kpi`, `KpiChangeRequest(+Edit)` (APPROVED), `CycleStage`,
`WorkingSchedule` / `PublicHoliday` (ADR-077).
