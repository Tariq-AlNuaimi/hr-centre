# Blueprint — JML slice S6c: historical exits, leaver reports, exit calendar

Scope: lib/jml/leave/**, lib/jml/reports/**, lib/jml/watch/**, lib/validations/jml/**, app/api/jml/leave-reports/**, app/api/jml/calendar/exits/**, app/api/jml/config/import-exits/**, components/jml/**, app/[locale]/(dashboard)/jml/**, prisma/schema.prisma, prisma/migrations/20261027170000_jml_s6_history/**, lib/pms/export/xlsx.ts, tests/contracts/jml-leave-reports.test.ts

Status: part of `docs/blueprints/jml.md` (slice 6, third PR). Port spec: HR Offboarding §2.17,
§2.19–2.21.

## What this slice delivers

- **Historical import (§26.2):** a CSV screen (dry run, then a second deliberate press). Required
  columns: caseRef, employeeExternalId (Odoo id or EMP code — the employee must exist on the core
  record), exitType, nationality, noticeStartDate, lastDayOfService; optional LPWD (defaults to
  the LDS), primaryL1/L2, secondaryL2, closedAt. A missing column refuses the file; bad rows are
  reported per line and nothing is written while any row has a problem; a reference twice in the
  file names both lines; a future LDS is refused (re-key it instead). Rows become CLOSED,
  `migrated` exits at Stage 4 with no tasks — never departing anyone. **F8 fixed:** coded
  reasons become an interview row (`conducted = IMPORTED`, scores now nullable), validated against
  the taxonomy, so history appears in R1/R3. Idempotent by reference.
- **Reports R1–R8 (Module 16):** period on the last day of service (default: the last twelve
  months), standard filters, the actor's report scope; capped at 5,000 with the cap reported;
  withdrawn exits excluded. R1 reasons with quarterly trend and secondary reasons (**F17**: the
  secondary code, not the primary category); R2 attrition by month/company/directorate/
  department/role/grade (denominator = the core employee record — the source needed hand-entered
  headcount snapshots); R3 regrettable/preventable with prevention factors (**F17**); R4 line
  manager pattern (always suppressed below 4 unless `jml.unsuppressedReports`); R5 tenure bands
  (UTC months — **F17**); R6 live cases by stage with overdue work and cycle time; R7 settlement
  buckets and days to payment; R8 Omanisation direction and ratio (target from the statutory
  parameter, "not available" when unset). Migrated history counts in R1–R5/R8, never R6/R7.
  Excel export: aggregate + summary + provenance, or one row per case with small-cell masking;
  settlement totals only with `jml.financialReports` and only for cases the reader may see
  settlements on. The narrative is never exported.
- **Exit calendar (Module 15):** a month of exit dates (LPWD and LDS, linked when different,
  weekends flagged, never moved).
- **Fix found on the way:** `buildReportWorkbook` (`lib/pms/export/xlsx.ts`) passed write-excel-file
  4 the legacy multi-sheet form, which it refuses — every workbook export through it failed.
  It now passes sheet objects.

## Scenarios

- Happy: import a 3-year spreadsheet → R1 shows the history's reasons; R2 by department shows
  rates against the record's headcount; export cases with settlement totals as an HR Manager.
- Worst: a file missing `exitType` → refused whole; an unknown employee id → that line named, nothing
  written; a Junior HR export with totals → 403; R4 for a Senior HR → managers with 1–3 exits merged.
