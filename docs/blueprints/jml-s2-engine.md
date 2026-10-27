# Blueprint — JML slice S2: the case engine

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/api/internal/jml-sweep/**, app/api/notifications/**, app/[locale]/(dashboard)/jml/**, components/jml/**, components/layout/AppSidebar.tsx, components/layout/Breadcrumbs.tsx, lib/rbac/catalogue.ts, lib/pms/notifications.ts, lib/email.ts, lib/prisma/soft-delete-extension.ts, lib/prisma/recyclable.ts, prisma/schema.prisma, vercel.json

Status: part of `docs/blueprints/jml.md` (slice 2). Decision D6 (one engine), D12 (permissions);
ADR-086.

## What this slice delivers

- **Schema:** `JmlCase` (header for JOIN/MOVE/LEAVE; archive is a status — F1; discarded drafts
  soft-delete), `JmlTaskTemplate` / `JmlTemplateTask` (Onboarding criteria + conditions ∪
  Offboarding scopes, codes, bases, blocking, confirmation, reversal, dependencies),
  `JmlTask` / `JmlTaskComment`, `JmlHrAssignmentRule` (scoped + priority + case types),
  `JmlContractType`, `JmlEmploymentTypeConfig`, `JmlEmailLog` (no body column),
  `JmlEmailTemplateOverride`; partial unique indexes (one JOIN per person, one ACTIVE MOVE, one
  open LEAVE). Core `Notification` gains `caseId`, `sendAfter`, `dismissedAt` and nine JML kinds.
- **Engine (pure, tested):** progress (per-type empty/cancelled rules, FLOORED for all — fixes
  Onboarding's rounding to 100), BR-013 completion, stage derivation (JOIN/MOVE) and stage
  advancement on blocking tasks (LEAVE, F4), completion gate (confirmation trio + dependencies),
  conditions (case-insensitive criteria — 8.4.9; payroll as a fact — 8.4.12), generation (both
  offset units over the one calendar, summary-dismissal re-anchoring, dependency pruning,
  default confirming party copied — F10), recalculation (only changed bases), reversals.
- **Services:** assignment rules (resolve + seats by permission), templates (versioning,
  selection for JOIN/MOVE/LEAVE — F11), tasks (one door: status/complete/N/A/reopen/delay/due/
  owner/reference; refused on non-live cases and to non-HR owners — 8.4.7; manual tasks;
  insert-only comments), case references with retry (8.4.8), JML notifications into the core
  feed with the Muscat window (F2), the joiner email queue (verbatim §11.2 copy, overrides,
  drain, retry, cancel), configuration (calendar + holidays, statutory create/verify, position
  classifications, contract types, employment-type config, EMP-code cutover).
- **Routes:** `/api/jml/me`, `/api/jml/lookups` (non-admin pickers — 8.4.2/F7),
  `/api/jml/config/**`, `/api/jml/tasks/**`, `/api/jml/cases/[id]/tasks`,
  `/api/jml/emails/[id]/retry`, `/api/notifications/dismiss`, `/api/internal/jml-sweep` (hourly
  cron: email drain + failed-email alerts; later slices add steps).
- **Screens:** `/jml/settings` hub and nine configuration screens; sidebar group.
- **Permissions:** 22 `jml.*` permissions; starter roles HR Manager / Senior HR / Junior HR.
  HR Super Admin stays the foundation's "everything" (modules are granted by their own roles).

## Acceptance (tests/contracts/jml-engine.test.ts)

AC-S2.1 progress rules per type and floored · AC-S2.2 BR-013 · AC-S2.3 confirmation trio named ·
AC-S2.4 dependency gate (S3-15 ← S4-04) · AC-S2.5 blocking-only stage close and one-step advance ·
AC-S2.6 conditions (BR-006, null fact, unreadable) and case-insensitive criteria · AC-S2.7
summary-dismissal re-anchoring and F10 · AC-S2.8 recalculation only moves changed bases ·
AC-S2.9 reversals only for completed reversible tasks · AC-S2.10 starter roles nest and HR Super
Admin is not widened · AC-S2.11 JML forms use the non-admin lookups route.

## Scenarios

- Happy: HR Manager records the cutover, adds a contract type and a rule, edits a template →
  version 2 saved, version 1 kept for the cases pinned to it.
- Worst: a Junior HR user opens a settings screen → "You do not have access"; the API answers 403.
- Worst: the sweep runs outside the window → the drain skips, nothing is lost; a failed send
  becomes an in-app alert to the case owner, once per case and message type.
