# DB structure tidy — migrations and schema.prisma agree (ADR-089)

Scope: prisma/schema.prisma, prisma/migrations/20261029100000_tidy_db_structure/**, scripts/ship.mjs, tests/integration/pgvector.test.ts

Status: operator-approved overnight item 1 (2026-10-28 brief). Decision record: ADR-089.

## Why

`ship:full`'s db-structure in-sync check, run against an empty shadow database, reported drift
that no feature introduced, and every `prisma migrate dev` proposed to drop real constraints to
"fix" it. Hand-written migrations had to dodge it each time.

## Stories and acceptance criteria

- **US-1 (developer) a clean diff.** AC-1.1 With an empty `SHADOW_DATABASE_URL`,
  `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma`
  is empty, and ship's db-structure check passes with the in-sync step actually run.
  AC-1.2 No allowlist: any reported difference is real drift.
- **US-2 (operator) production is untouched in meaning.** AC-2.1 The migration only renames
  constraints/indexes and drops the unused pgvector table; no column, type, constraint
  behaviour or row changes. AC-2.2 A database at the production head, after this migration,
  diffs empty against the schema. AC-2.3 A database migrated from scratch diffs empty too.

## Happy path

Deploy runs `prisma migrate deploy`; thirteen renames apply; `document_embedding` (empty) is
dropped; the app behaves exactly as before.

## Worst paths

- `document_embedding` holds a row → the migration raises and the deploy stops; nothing is
  dropped. Model the table instead.
- A legacy name is already absent (renamed by hand) → that rename is skipped, not failed.
- A future feature re-adds raw-SQL objects → the in-sync check goes red until they are
  modelled (`@@unique`, composite relations, `@@index(..., type: Gin)`) or the migration and
  the schema otherwise agree.

## Data

Annotations only on Directorate, Department, Team, Employee (composite `*Agree` relations,
read-only in practice), EmployeeAssignmentPeriod (`onDelete: Restrict`), Kpi (index),
NetworkProvider (trigram GIN index). Migration `20261029100000_tidy_db_structure`.
