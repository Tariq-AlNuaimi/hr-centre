# ADR-089 — Migration history and schema.prisma describe the same database

**Status:** Accepted — operator-approved overnight item "tidy migration" (2026-10-28 brief)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)
**Supersedes (in part):** ADR-043 — the pgvector `document_embedding` table is dropped.

## Context

`ship:full`'s db-structure in-sync check (`prisma migrate diff --from-migrations
--to-schema`, needs an empty `SHADOW_DATABASE_URL`) reported drift on main that no
feature had introduced, and every `prisma migrate dev` proposed to "fix" it by
dropping real constraints (several hand-written migrations carry warnings about it):

- the template's pgvector `document_embedding` table (no model; `lib/ai/rag.ts` was
  never carried into HR Centre, so nothing reads or writes it);
- the composite agreement keys and FKs (`departments_id_entity_key`,
  `directorates_id_entity_key`, `teams_id_department_key`,
  `employees_department_entity_agree_fkey`, `departments_directorate_entity_agree_fkey`,
  `employees_team_department_agree_fkey`);
- `kpis_assignment_period_id_idx` and the pg_trgm GIN index on provider names;
- `ON DELETE RESTRICT` on `employee_assignment_periods.department_id` (schema said SET NULL);
- thirteen legacy constraint/index names from the raw-SQL PMS migrations.

The migration comments claimed Prisma "cannot express" the composite FKs and the
trigram index. It can: composite relations over a `@@unique`, and
`@@index([name(ops: raw("gin_trgm_ops"))], type: Gin)`.

## Decision

1. **Model what exists** (annotations only, no DB change): composite `@@unique`s with
   their real names, composite relations named `*Agree` (read-only in practice — code
   keeps writing the single-column FKs), the KPI index, the GIN index, `onDelete:
Restrict` on the assignment-period department.
2. **Rename** the legacy constraints/indexes to the names Prisma derives
   (`20261029100000_tidy_db_structure`, `ALTER … RENAME` only).
3. **Drop `document_embedding`**, guarded: the migration raises instead of dropping if
   the table holds any row. The `vector` extension stays installed (harmless; Prisma
   does not diff extensions).
4. Remove ship's `RAW_SQL_TABLES` allowlist and the pgvector integration test — any
   reported difference is now real drift.

## Evidence (2026-10-29)

- Empty shadow DB: `prisma migrate diff --from-migrations prisma/migrations
--to-schema prisma/schema.prisma` → empty migration.
- DB migrated from scratch: `migrate diff --from-config-datasource --to-schema` →
  "No difference detected".
- DB migrated to the production head (origin/main's 44 migrations), then this
  migration applied: same → "No difference detected". Control: the same DB before
  this migration shows 22 differences.

## Consequences

- `prisma migrate dev --create-only` now generates clean migrations; hand-writing to
  dodge phantom drops is no longer necessary.
- Re-adding RAG means a new migration and a model (or an explicit allowlist) — ADR-043
  is history, not a live seam.
