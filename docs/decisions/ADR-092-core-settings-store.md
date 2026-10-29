# ADR-092 — One settings store: `ModuleSetting(module, key, value)`

**Status:** Accepted — operator-approved P2 platform roadmap (item 2)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

Hiring kept Interview Hub's key/JSON `HiringSetting`; HR tickets a singleton
`HiveTicketSettings`; JML read its desk addresses and case links from environment
variables only HR's IT contact could change. Three mechanisms for one idea
(audit: `ux/tickets-hiring.md` §2C-4, P2-2; `ux/shell-people.md` §2).

## Decision drivers

- One store, one audit story; a module never defines its own settings table.
- Existing values survive the move unchanged (sealed secrets stay sealed).
- No behaviour change for a deployment configured the old way.

## Considered options

### Option 1 — `core_module_settings` keyed `(module, key)` with JSON values (chosen)

`lib/core/settings/store.ts`: read one, read many (one query), write (audited
find-then-write, P2002 retried as update), clear. Modules validate values with their
own zod schemas.

- Good, because adding a setting needs no migration.
- Good, because every change is an audit row with the editor.
- Bad, because values are untyped JSON at rest — each reader re-validates (already the
  pattern in Hiring and tickets).

### Option 2 — keep per-module tables, share only a UI shell

- Bad, because each new module adds a table, a writer and an audit path.

### Option 3 — a typed column per setting on one wide singleton

- Bad, because every setting is a migration and module ownership is lost.

## Decision

Option 1. Modules: `hiring` (all Interview Hub keys, copied from `hiring_settings`),
`tickets` (`ticketPrefix`, `statusLabels`, `responseHours`, copied from the singleton),
`jml` (desk emails `itEmail`/`proEmail`/`payrollEmail` and links `odooUrl`/
`staffingFormUrl`, new: HR edit them under JML settings › Desk emails and links; the old
env var applies until HR save a value). `platform` is reserved for platform-wide
settings (AI provider). Reference data HR maintain as lists (contract types, reason
codes, asset types) stays in module tables. The IT intake integration stays env-only:
it carries a credential and design gate G6.

The legacy `hiring_settings` and `hive_ticket_settings` tables are dropped in a later
migration once the new path is verified live.
