-- ADR-102: one "who is my HR" model. HR tickets' pair coverage becomes the core
-- HR coverage table IN PLACE (every row and id kept); JML's HR assignment rules
-- are copied into it with their ids. `jml_hr_assignment_rules` stays until the
-- core path is verified live (dropped in a later migration).

-- CreateEnum
CREATE TYPE "HrCoverageLevel" AS ENUM ('COMPANY', 'DIRECTORATE', 'DEPARTMENT', 'TEAM');

-- Rename in place
ALTER TABLE "hive_hr_tag_coverage" RENAME TO "core_hr_coverage";
ALTER TABLE "core_hr_coverage" RENAME CONSTRAINT "hive_hr_tag_coverage_pkey" TO "core_hr_coverage_pkey";
ALTER TABLE "core_hr_coverage" RENAME CONSTRAINT "hive_hr_tag_coverage_pairId_fkey" TO "core_hr_coverage_pairId_fkey";
ALTER TABLE "core_hr_coverage" RENAME CONSTRAINT "hive_hr_tag_coverage_company_wide_needs_entity" TO "core_hr_coverage_company_wide_needs_entity";
ALTER INDEX "hive_hr_tag_coverage_pairId_idx" RENAME TO "core_hr_coverage_pairId_idx";
ALTER INDEX "hive_hr_tag_coverage_entityId_idx" RENAME TO "core_hr_coverage_entityId_idx";
ALTER INDEX "hive_hr_tag_coverage_deletedAt_createdAt_idx" RENAME TO "core_hr_coverage_deletedAt_createdAt_idx";

-- AlterTable
ALTER TABLE "core_hr_coverage" ALTER COLUMN "pairId" DROP NOT NULL,
ALTER COLUMN "label" SET DEFAULT '',
ADD COLUMN "team_id" TEXT,
ADD COLUMN "level" "HrCoverageLevel",
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "case_types" "JmlCaseType"[] DEFAULT ARRAY[]::"JmlCaseType"[],
ADD COLUMN "owner_user_id" TEXT,
ADD COLUMN "supervisor_user_id" TEXT;

-- A JML row names both seats or neither (a ticket-only row names none).
ALTER TABLE "core_hr_coverage" ADD CONSTRAINT "core_hr_coverage_seats_together"
  CHECK (("owner_user_id" IS NULL) = ("supervisor_user_id" IS NULL));

-- CreateIndex
CREATE INDEX "core_hr_coverage_active_level_priority_idx" ON "core_hr_coverage"("active", "level", "priority");
CREATE INDEX "core_hr_coverage_departmentId_idx" ON "core_hr_coverage"("departmentId");
CREATE INDEX "core_hr_coverage_directorateId_idx" ON "core_hr_coverage"("directorateId");
CREATE INDEX "core_hr_coverage_owner_user_id_idx" ON "core_hr_coverage"("owner_user_id");
CREATE INDEX "core_hr_coverage_supervisor_user_id_idx" ON "core_hr_coverage"("supervisor_user_id");

-- AddForeignKey
ALTER TABLE "core_hr_coverage" ADD CONSTRAINT "core_hr_coverage_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "core_hr_coverage" ADD CONSTRAINT "core_hr_coverage_supervisor_user_id_fkey" FOREIGN KEY ("supervisor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The level of every ticket row: the most specific unit it names (the same
-- order the ticket selector reads: department, then directorate, then company).
UPDATE "core_hr_coverage" SET "level" = (CASE
  WHEN "companyWide" THEN 'COMPANY'
  WHEN "departmentId" IS NOT NULL THEN 'DEPARTMENT'
  WHEN "directorateId" IS NOT NULL THEN 'DIRECTORATE'
  WHEN "entityId" IS NOT NULL THEN 'COMPANY'
  ELSE NULL END)::"HrCoverageLevel";

-- Copy JML's assignment rules (ids kept): scope → level + the unit's own column
-- (a department row names only its department), its company, priority, active, case types, owner and supervisor.
INSERT INTO "core_hr_coverage" ("id", "pairId", "label", "aliases", "entityId", "companyWide",
  "directorateId", "departmentId", "level", "priority", "active", "case_types",
  "owner_user_id", "supervisor_user_id", "createdAt", "updatedAt")
SELECT r."id", NULL, '', ARRAY[]::TEXT[],
  CASE r."scope"
    WHEN 'COMPANY' THEN r."scope_id"
    WHEN 'DIRECTORATE' THEN (SELECT d."entity_id" FROM "directorates" d WHERE d."id" = r."scope_id")
    ELSE (SELECT p."entityId" FROM "departments" p WHERE p."id" = r."scope_id") END,
  false,
  CASE WHEN r."scope" = 'DIRECTORATE' THEN r."scope_id" END,
  CASE WHEN r."scope" = 'DEPARTMENT' THEN r."scope_id" END,
  r."scope"::text::"HrCoverageLevel", r."priority", r."active", r."case_types",
  r."junior_hr_user_id", r."senior_hr_user_id", r."created_at", r."updated_at"
FROM "jml_hr_assignment_rules" r
ON CONFLICT DO NOTHING;
