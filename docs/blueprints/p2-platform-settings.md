# P2 platform — one settings store (ADR-092)

Scope: lib/core/settings/store.ts, lib/hiring/settings.ts, lib/hive/services/ticket-settings.ts, lib/hive/services/ticket-sla.ts, lib/jml/desks.ts, lib/validations/jml/config.ts, app/api/jml/config/contacts/route.ts, app/[locale]/(dashboard)/jml/settings/contacts/page.tsx, components/jml/settings/ContactSettings.tsx, prisma/schema.prisma, prisma/migrations/20261029120620_core_module_settings/**, prisma/seed-hiring.ts

Status: operator-approved P2 roadmap, item 2 (settings). Audit: `ux/tickets-hiring.md` P2-2.
Feature parity: n/a — internal consolidation; the one new screen replaces env-only configuration.

## Stories and acceptance criteria

- **US-1 (module developer) one place to keep a setting.** AC-1.1 `readModuleSetting`,
  `readModuleSettings` (one query), `writeModuleSetting` (audited find-then-write,
  race-safe) and `clearModuleSetting` on `core_module_settings`. AC-1.2 No upsert.
- **US-2 (hiring admin) my configuration is still there.** AC-2.1 Every `hiring_settings`
  row is copied to module `hiring` with its value unchanged (the sealed AI key stays
  sealed). AC-2.2 Hiring reads and writes only the core store; the seed's `setOnce`
  writes there and skips keys already present.
- **US-3 (HR tickets editor) prefix, labels and answer-by target unchanged.** AC-3.1 The
  singleton is copied into three keys under `tickets`. AC-3.2 Defaults with nothing
  stored; junk labels ignored on read; an absent answer-by target leaves the stored one.
- **US-4 (HR, JML configure) I can set desk emails and case links myself.** AC-4.1 JML
  settings › Desk emails and links edits IT, PRO and payroll emails and the Odoo and
  staffing form links. AC-4.2 An HR value wins; an empty field falls back to the
  deployment's env var; with neither, the notice or link is off (as before). AC-4.3 Each
  field says where its value comes from. AC-4.4 GET and PUT need `jml.configure` for the
  group; inputs are validated (email, https URL).

## Worst paths

- A setting row holds junk → the module's reader falls back to its default.
- Two first saves race → the loser's P2002 becomes an update.
- The seed runs after the copy → keys already present are left alone.
- HR clear a value with no env var → the notice is off, exactly as an unset env var was.

## Data

`ModuleSetting` → `core_module_settings` (`module`, `key`, unique together; `value` JSON;
`updated_by_id` → users). Migration `20261029120620_core_module_settings` creates it and copies both legacy stores.
