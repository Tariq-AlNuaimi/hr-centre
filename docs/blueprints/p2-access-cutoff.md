# P2 — Scheduled access cut-off for leavers

Scope: prisma/schema.prisma, prisma/migrations/*_p2_jml_access_cutoff/**, lib/jml/leave/cutoff.ts, lib/jml/leave/departure.ts, lib/jml/leave/sweep-steps.ts, lib/jml/register/access-items.ts, lib/validations/jml/leave.ts, lib/validations/jml/preboarding.ts, app/api/jml/cases/[id]/access-cutoff/route.ts, app/api/jml/cases/[id]/preboarding/route.ts, components/jml/case/**, messages/**, tests/contracts/p2-access-cutoff.test.ts

Status: operator-approved P2 roadmap (2026-10-29). Source: UX audit `performance-jml.md` P2-5.
Benchmark: Rippling scheduled deprovisioning (immediate or at a set time, app-by-app status report);
HiBob "close access at the end of the last day".

## Stories and acceptance criteria

- **US-1 (HR, IT) the login is cut at a known moment.** AC-1.1 Every leaver has an access cut-off:
  by default 17:00 in the organisation's zone (Asia/Muscat) on the Last Physical Working Day.
  AC-1.2 An HR user with `jml.manageLeavers` in scope can set another date and time (entered as
  wall-clock time in that zone) or restore the default. AC-1.3 The hourly JML sweep revokes the
  login at its first run on or after the cut-off (previously: the day after the last physical
  working day), through the existing `revokeLoginOnOffboard`; the instant is stamped on the case.
  AC-1.4 Once revoked, the cut-off can no longer be changed; closed/cancelled exits refuse it.
- **US-2 (HR, IT) see access status at a glance.** AC-2.1 The Access register opens with the
  cut-off (scheduled / revoked, login active / revoked) and a per-system-type summary: done of total
  and overdue, before the item list.

## Worst paths

- No last physical working day and no explicit time → "No cut-off yet", nothing is revoked.
- HR sets a time in the past → the next hourly sweep revokes.
- Bad input ("tomorrow", month 13) → 422 with "Use a date and time.".
- A migrated exit (re-keyed history) → never revoked by the sweep (unchanged).

## Data

`leave_case_details.access_cutoff_at` (nullable timestamp, additive). Null = the default.
