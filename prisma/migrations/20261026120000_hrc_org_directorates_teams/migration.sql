-- HR Centre foundation F-a — directorates and teams (blueprint
-- docs/blueprints/hr-centre-foundation.md §1).
--
-- HAND-WRITTEN, like its siblings: `prisma migrate dev` would also try to drop
-- the hand-written composite FKs and `document_embedding`, none of which this
-- change touches.
--
-- Additive only: two new tables, two new NULLABLE columns, and the invariants
-- that make a cross-company directorate or a cross-department team
-- unrepresentable for EVERY writer (import, form, a future Odoo sync, a hand-run
-- SQL fix) — the same composite-FK technique Phase 1 used for
-- department↔entity (`employees_department_entity_agree_fkey`).

-- CreateTable
CREATE TABLE "directorates" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "entity_id"  TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "deleted_at"    TIMESTAMP(3),
    "deleted_by"    TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "departments" ADD COLUMN "directorate_id" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "team_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "directorates_entity_id_name_key" ON "directorates"("entity_id", "name");
CREATE INDEX "directorates_deleted_at_created_at_idx" ON "directorates"("deleted_at", "created_at");
CREATE UNIQUE INDEX "teams_department_id_name_key" ON "teams"("department_id", "name");
CREATE INDEX "teams_deleted_at_created_at_idx" ON "teams"("deleted_at", "created_at");
CREATE INDEX "departments_directorate_id_idx" ON "departments"("directorate_id");
CREATE INDEX "employees_team_id_idx" ON "employees"("team_id");

-- AddForeignKey (the simple FKs Prisma models)
ALTER TABLE "directorates" ADD CONSTRAINT "directorates_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "org_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_directorate_id_fkey"
  FOREIGN KEY ("directorate_id") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants the Prisma datamodel cannot express (blueprint AC-F1.1, AC-F1.2).
-- The service layer (lib/org/units.ts, lib/people/*) refuses these first, with
-- a message on the right field; these are the backstop.
-- ---------------------------------------------------------------------------

-- A department's directorate must be in the department's company. Composite FK
-- against a matching unique pair, exactly like departments_id_entity_key.
-- MATCH SIMPLE skips the check when directorate_id is NULL — a department
-- directly under a company (TP, CL) is the ordinary case.
-- ON UPDATE RESTRICT: moving a department to another company while it still
-- points at a directorate of the old one is refused, not silently cascaded.
ALTER TABLE "directorates"
  ADD CONSTRAINT "directorates_id_entity_key" UNIQUE ("id", "entity_id");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_directorate_entity_agree_fkey"
  FOREIGN KEY ("directorate_id", "entityId")
  REFERENCES "directorates"("id", "entity_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- An employee's team must be in the employee's department.
ALTER TABLE "teams"
  ADD CONSTRAINT "teams_id_department_key" UNIQUE ("id", "department_id");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_team_department_agree_fkey"
  FOREIGN KEY ("team_id", "departmentId")
  REFERENCES "teams"("id", "department_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- MATCH SIMPLE would skip the FK above for a C-Level employee (departmentId
-- NULL) who somehow carries a team. A team without a department is never
-- legitimate, so refuse it outright.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_team_requires_department_check"
  CHECK ("team_id" IS NULL OR "departmentId" IS NOT NULL);
