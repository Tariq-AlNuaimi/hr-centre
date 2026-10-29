# P2 platform — core code out of `lib/pms` (ADR-091)

Scope: lib/core/actor.ts, lib/core/permissions.ts, lib/core/employee-select.ts, lib/core/export/**, lib/core/notify/**, lib/pms/notifications.ts, lib/pms/cycle-notify.ts

Status: operator-approved P2 roadmap, item 6 (code organisation). Audit: `ux/performance-jml.md` P2-6.
Feature parity: n/a — internal code organisation.

## Stories and acceptance criteria

- **US-1 (developer) platform code has a platform path.** AC-1.1 actor, permissions,
  employee-select (salary crypto), xlsx export, the notification store and the user
  notifier live under `lib/core/*`. AC-1.2 No file imports them from `lib/pms` or
  `lib/notifications`. AC-1.3 Export names are unchanged.
- **US-2 (every user) nothing changes.** AC-2.1 The full contract and component
  suites pass unmodified except for import paths and mock targets.
- **US-3 (developer) the actor identity split is written down.** AC-3.1 ADR-091
  documents User vs Employee actor keys.

## Worst paths

- A test mocks the old path → it no longer intercepts; the mock targets were moved with
  the modules (`ux-performance` now mocks `lib/core/notify/store.ts`).
- Parallel work imports an old path → typecheck fails on rebase with a clear missing
  module; the fix is the path in this blueprint.
