# ADR-091 — Core services live in `lib/core/*`; module folders hold module rules

**Status:** Accepted — operator-approved P2 platform roadmap (item 6)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

The request actor, the people permission rules, the employee select/serialiser with
salary crypto, the xlsx report builder, the notification store and the login-addressed
notifier grew up inside Performance (`lib/pms/*`) and `lib/notifications/`. JML, Hiring
and HR tickets import them, so "performance" reads as the owner of platform code
(audit: `ux/performance-jml.md` §2.2, P2-6; `ux/shell-people.md` §2).

## Decision drivers

- Ownership readable from the path; the next module must not import from "performance".
- Pure move: no behaviour change, no renamed exports (rebases stay cheap for parallel work).

## Considered options

### Option 1 — move into `lib/core/*`, update importers, keep export names (chosen)

`lib/core/actor.ts`, `lib/core/permissions.ts`, `lib/core/employee-select.ts`,
`lib/core/export/xlsx.ts`, `lib/core/notify/store.ts` (feed owner, page size, body cap,
`persistNotifications`, split out of `lib/pms/notifications.ts`) and
`lib/core/notify/user-notify.ts`. Performance keeps its ladder keys and kinds.

- Good, because every importer now names the real owner.
- Bad, because a one-time import churn across ~130 files.

### Option 2 — re-export shims under `lib/pms/*`

- Good, because no importer changes.
- Bad, because two paths to one module forever (knip flags the shims; new code keeps
  importing the wrong one).

## Decision

Option 1. `PmsActor`/`PmsCapabilities` keep their names for now (renaming every
reference adds churn without changing meaning); they describe the platform actor.

## Actor identity: User vs Employee (documented, not changed)

Actor foreign keys stay split, deliberately:

- **User** (`*ById`, `ownerUserId`, `decidedById`) for _who did it in the system_: a
  login exists for every actor; many approvers, panelists and HR staff have no employee
  record, and audit attribution is per login.
- **Employee** for _who it is about or who holds authority in the org_: subjects,
  managers, approval holders (`holderEmployeeId`), Performance sign-offs.
- The bridge is `Employee.userId` (one login per employee). Feeds read both
  (`feedOwnerWhere`). New tables follow the same rule; no migration is planned.
