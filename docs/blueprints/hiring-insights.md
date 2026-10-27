# Blueprint — Hiring slice 7b: insights, retention and data-subject requests

Part of `docs/blueprints/hiring.md`. Ports Interview Hub's `/insights` (+ `/api/executive/velocity`,
`/omanization`, `/dei`), its PDPL erasure (`lib/pdpl.ts`), the DSAR endpoint and the daily
retention cron. The operator authorised the cron route `/api/internal/hiring-retention` in
`vercel.json` with the internal-route wrapper and `CRON_SECRET`.

Scope: app/api/hiring/insights/**, app/api/hiring/candidates/**, app/api/hiring/settings/**, app/api/internal/hiring-retention/**, app/[locale]/(dashboard)/hiring/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**, lib/env.ts, vercel.json

## Stories

- As HR or a hiring leader, I see open requisitions, active candidates, upcoming interviews, live
  offers, hires, offer acceptance and average time to hire, the pipeline funnel, and time to hire
  per company — over the requisitions I can see.
- As HR, I see Omani hires against each company's Tawteen target, which a hiring admin sets.
- As someone with DEI rights, I see self-declared gender and ethnicity with small groups withheld.
- As a hiring admin with erase rights, I export everything held about a candidate, or erase it.
- As the organisation, rejected, withdrawn and deleted candidates are erased automatically after
  the retention period.

## Scenarios

Happy: a CL-scoped HR manager opens Insights → every number covers CL only, with a note saying
so → Omanization shows CL 2 of 3 hires (67%) on a 60% target → on target.

Worst:

- D12: Interview Hub's dashboard, velocity and Omanization were organisation-wide and readable by
  viewers → here every query is built from `requisitionScopeWhere(actor, …)`; no scope → 403.
- Four candidates declared a rare ethnicity → their bucket is merged into "Withheld (small
  groups)" (fewer than 5 never shown on its own).
- D6: erasure left the sealed salary expectation, HR notes, package documents and their files,
  negotiation notes, offer versions and the CV file → all are erased or deleted; the values in
  the audit rows of every erased record are redacted; files are removed after commit.
- A hired candidate (linked to an employee) → erase refused with a sentence; the retention sweep
  never selects them.
- A retention backlog → 25 per run, `more: true`, next day continues; one failure does not stop
  the batch. `CRON_SECRET` unset → silent no-op.
- Erasing twice → the second call says it was already erased.

## Architecture

- `lib/hiring/analytics.ts` (+ pure `analytics-rules.ts`): KPIs, funnel (groupBy), velocity from
  `hiring_stage_history` (exact move into HIRED, ≤ 10,000 most recent, truncation flagged),
  Omanization (≤ 10,000 hires, `tawteen.targets` per company code), DEI (groupBy, suppressed).
- `lib/hiring/erasure.ts`, `lib/hiring/retention.ts` (`CANDIDATE_RETENTION_DAYS`, default 365),
  `lib/hiring/dsar.ts`; routes `/api/hiring/insights`, `/api/hiring/candidates/[id]/dsar`,
  `/api/internal/hiring-retention` (daily 04:00 UTC).
- `/hiring/insights`; Tawteen targets under Hiring settings → Budget envelopes; data-protection
  card on the candidate's Timeline tab (org-wide erase rights only).

## Changes from Interview Hub

- Velocity is exact (stage history), not the createdAt → updatedAt approximation.
- The Omanization target lives in hiring settings per company code, not on the organisation.
- Erasure is complete (D6) and refuses employees; DSAR is `hiring.erase`, not any admin.

## Open questions

- None. `CRON_SECRET` is already set in production for the other crons.
