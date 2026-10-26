# Blueprint — HR Centre foundation, slice F-b (employee record)

Scope: lib/people/**, lib/crypto/**, lib/validations/people.ts, lib/pms/employee-select.ts, lib/pms/permissions.ts, lib/pms/import/**, lib/pms/export/xlsx.ts, lib/prisma/audit-extension.ts, app/api/employees/**, app/api/imports/**, app/[locale]/(dashboard)/people/**, components/people/**, components/pms/EmployeeEditForm.tsx, prisma/schema.prisma

Status: SIGNED OFF as part of `docs/blueprints/hr-centre-foundation.md` (operator,
2026-10-26). This file is the slice contract: the stories, acceptance criteria and
scenarios are the parent's **US-F2** (AC-F2.1–AC-F2.3) and **US-F5** (AC-F5.1,
AC-F5.2); the field table is the parent's §2. Nothing here widens them.

## What this slice delivers

- The record fields of the parent §2 table on `Employee`, all optional.
- ID numbers encrypted at rest under `ID_ENCRYPTION_KEY` (ADR-067 envelope,
  AAD = `odooId`), scrubbed from audit, the restricted-export list and db-sql.
- Field-level visibility from permissions in `lib/pms/employee-select.ts`.
- One writer, `lib/people/write.ts`, used by the import, the Add employee form
  and the core employee PUT.
- Fifteen optional import columns; Add employee page; Edit details dialog.

## Build notes (decisions taken on the stated defaults)

- Record fields are optional everywhere with one meaning: absent =
  leave alone, empty = clear. The core `PUT /api/employees/[id]` stays a full
  replace of the Performance fields; the new record fields have a PARTIAL
  `PATCH /api/employees/[id]/record` so an editor never blanks a field they
  cannot see. Writing personal fields needs `viewPersonal`, writing ID documents
  needs `viewIdDocuments` (until F-c: HR = Super Admin or HRBP; editing people
  at all is still the Super Admin's `configure`). Line managers and the
  executive viewer see job and work contact only (open question 3's default).
  Personal and ID values are redacted in the stored import preview. A DB CHECK
  refuses anything but a `v1.` envelope in the two `*_enc` columns.

## Scenarios checked

- Happy: HR adds an employee by form with job, personal and ID details → the
  row matches what the import's writer produces (contract test AC-F5.2); the
  passwordless login record is provisioned exactly as the import does.
- Worst: the ID key is missing → ID writes fail with a 503 sentence and nothing
  is saved; reads show "cannot be shown right now" for the numbers only.
- Worst: a line manager or the executive viewer opens a record → no personal or
  ID column is in the select, so none can be in any payload.
