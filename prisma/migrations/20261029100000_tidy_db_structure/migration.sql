-- Tidy migration: make the migration history and schema.prisma describe the same
-- database. RENAMES AND ONE GUARDED DROP ONLY — no column, type or data change.
--
-- Before this, `prisma migrate diff --from-migrations --to-schema` (ship's
-- db-structure in-sync check, run with SHADOW_DATABASE_URL) reported drift that
-- every `migrate dev` wanted to "fix" by dropping real constraints. That drift
-- is now closed from both sides:
--   * schema.prisma now models the composite agreement keys/FKs, the
--     kpis(assignment_period_id) index, the pg_trgm GIN index and the
--     ON DELETE RESTRICT on employee_assignment_periods.department_id
--     (annotations only — those objects already exist and are unchanged);
--   * this file renames the hand-named constraints/indexes from the raw-SQL
--     PMS migrations to the names Prisma derives, and drops the unused pgvector
--     table.

-- Each rename is guarded (skips when the old name is absent), so a database that
-- somehow already carries the new name cannot fail the deploy.

-- 1. Legacy foreign-key names (20260825180000 / 20260825200000) → Prisma's names.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_templates_cycle_fkey' AND conrelid = '"assessment_templates"'::regclass) THEN
    ALTER TABLE "assessment_templates" RENAME CONSTRAINT "assessment_templates_cycle_fkey" TO "assessment_templates_three_sixty_cycle_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_cycle_fkey' AND conrelid = '"assignments"'::regclass) THEN
    ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_cycle_fkey" TO "assignments_three_sixty_cycle_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calibration_adjustments_by_fkey' AND conrelid = '"calibration_adjustments"'::regclass) THEN
    ALTER TABLE "calibration_adjustments" RENAME CONSTRAINT "calibration_adjustments_by_fkey" TO "calibration_adjustments_adjusted_by_employee_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calibration_adjustments_score_fkey' AND conrelid = '"calibration_adjustments"'::regclass) THEN
    ALTER TABLE "calibration_adjustments" RENAME CONSTRAINT "calibration_adjustments_score_fkey" TO "calibration_adjustments_employee_score_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cycle_publications_by_fkey' AND conrelid = '"cycle_publications"'::regclass) THEN
    ALTER TABLE "cycle_publications" RENAME CONSTRAINT "cycle_publications_by_fkey" TO "cycle_publications_published_by_employee_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_scores_entered_by_fkey' AND conrelid = '"department_scores"'::regclass) THEN
    ALTER TABLE "department_scores" RENAME CONSTRAINT "department_scores_entered_by_fkey" TO "department_scores_entered_by_employee_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_scores_entered_by_fkey' AND conrelid = '"entity_scores"'::regclass) THEN
    ALTER TABLE "entity_scores" RENAME CONSTRAINT "entity_scores_entered_by_fkey" TO "entity_scores_entered_by_employee_id_fkey";
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_runs_started_by_fkey' AND conrelid = '"score_runs"'::regclass) THEN
    ALTER TABLE "score_runs" RENAME CONSTRAINT "score_runs_started_by_fkey" TO "score_runs_started_by_employee_id_fkey";
  END IF;
END $$;

-- 2. Legacy index names → Prisma's names. The last one was silently truncated
--    to 63 bytes by PostgreSQL; Prisma truncates differently.
ALTER INDEX IF EXISTS "assessment_templates_cycle_type_key" RENAME TO "assessment_templates_three_sixty_cycle_id_type_key";
ALTER INDEX IF EXISTS "assignments_cycle_ratee_idx" RENAME TO "assignments_three_sixty_cycle_id_ratee_id_idx";
ALTER INDEX IF EXISTS "assignments_cycle_ratee_rater_key" RENAME TO "assignments_three_sixty_cycle_id_ratee_id_rater_id_key";
ALTER INDEX IF EXISTS "calibration_adjustments_score_adjusted_at_idx" RENAME TO "calibration_adjustments_employee_score_id_adjusted_at_idx";
ALTER INDEX IF EXISTS "employee_assignment_periods_employee_id_cycle_id_order_index_ke" RENAME TO "employee_assignment_periods_employee_id_cycle_id_order_inde_key";

-- 3. The template's pgvector RAG store (20260711120000_pgvector_rag). Nothing in
--    HR Centre reads or writes it (lib/ai/rag.ts was never carried over). The
--    guard refuses to drop a table that holds rows, so this can never destroy
--    data: if it fires, someone started using the table and it must be modelled
--    instead. The `vector` extension is left installed (harmless, not diffed).
DO $$
BEGIN
  IF to_regclass('public.document_embedding') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "document_embedding" LIMIT 1) THEN
      RAISE EXCEPTION 'document_embedding holds rows; refusing to drop it (model it instead)';
    END IF;
    DROP TABLE "document_embedding";
  END IF;
END $$;
