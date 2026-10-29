# P2 — Performance parity (calibration chart, 9-box, prior cycle, My year, rating context, working-day grace)

Scope: lib/pms/distribution.ts, lib/pms/calibration.ts, app/api/calibration/route.ts, app/[locale]/(dashboard)/calibration/page.tsx, app/[locale]/(dashboard)/executive/page.tsx, components/pms/**, components/shared/Chart.impl.tsx, messages/**, tests/contracts/p2-performance.test.ts

Status: operator-approved P2 roadmap (2026-10-29). Source: UX audit `performance-jml.md` P2-1, P2-2,
P2-3, P2-9. Benchmarks: Culture Amp ratings matrix and past-cycle comparison, Lattice calibration,
Culture Amp's questions-left / context-right review form.

## Slice A — calibration distribution chart, 9-box, prior cycle (P2-1)

- **US-1 (HR Super Admin) see the curve.** AC-1.1 Calibration shows a grouped bar chart of the
  share of people per band (best band first), percentages to one decimal. AC-1.2 When a target
  distribution exists, the target share is a second series; when an earlier cycle has a score run,
  its calibrated share is a third series named by its year. AC-1.6 The same chart appears on
  Reports > Distribution (actual vs target) and on the Executive view (actual).
- **US-2 (HR Super Admin) compare with last cycle per person.** AC-1.5 Each person's row on
  Calibration states last cycle's calibrated band, or "not scored" when they had none.
- **US-3 (HR Super Admin) optional 9-box.** AC-1.3 A 3×3 grid: rows = calibrated band tier
  (outstanding/excellent, target, below target), columns = 360 level tier (<3, 3–<4, ≥4); counts and
  up to six names per cell. People with no 360 level (C-Level track, no scored form) are counted
  under the grid and never placed.
- **Guardrails.** Nothing on the chart or the 9-box moves a band (§10.4 guided, not forced). The
  GET stays HR Super Admin only (§10.6). AC-1.4 the chart helpers are client-safe (no Prisma
  runtime in the browser bundle).

### Worst paths

- Empty cycle / no score run → no chart (headcount 0), no 9-box, the existing empty states stand.
- No earlier cycle, or an earlier cycle without a score run → the prior series and per-person
  prior band are absent ("not scored"), never zero-filled.
- Unknown `cycleId` → 404 (previously an empty 200).
- Prior cycle with thousands of scores → read bounded (`take: 4000`), same bound as the current run.

## Data

None new. Reads `EmployeeScore.calibratedBand`, `threeSixtyScore` (0–5 level) and the nearest
earlier `PerformanceCycle.year` with a `ScoreRun`.
