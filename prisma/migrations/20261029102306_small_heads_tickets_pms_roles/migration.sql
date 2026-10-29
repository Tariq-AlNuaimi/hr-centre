-- Overnight item 2 (docs/blueprints/small-items.md):
--   * HR raises a ticket on an employee's behalf: EscalationSource HR + raised_by_id.
--   * Unit heads: a nullable head_employee_id on companies, directorates,
--     departments and teams (ON DELETE SET NULL).
--   * Leader names HIVE kept as free text (hive_org_unit_info."leaderName") become
--     heads where the name matches exactly ONE current employee (case- and
--     space-insensitive, anywhere in the group). Anything else stays blank; the
--     free text is kept (read-only) so nothing is lost.
--   * employees."pmsRoles" and its enum are dropped. Nothing reads them: the
--     one-time conversion to role assignments ran in 20261026180000 and is NOT
--     repeated (re-deriving would resurrect assignments an admin removed).
-- AlterEnum
ALTER TYPE "EscalationSource" ADD VALUE 'HR';

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "head_employee_id" TEXT;

-- AlterTable
ALTER TABLE "directorates" ADD COLUMN     "head_employee_id" TEXT;

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "pmsRoles";

-- AlterTable
ALTER TABLE "hive_escalations" ADD COLUMN     "raised_by_id" TEXT;

-- AlterTable
ALTER TABLE "org_entities" ADD COLUMN     "head_employee_id" TEXT;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "head_employee_id" TEXT;

-- DropEnum
DROP TYPE "PmsRole";

-- CreateIndex
CREATE INDEX "departments_head_employee_id_idx" ON "departments"("head_employee_id");

-- CreateIndex
CREATE INDEX "directorates_head_employee_id_idx" ON "directorates"("head_employee_id");

-- CreateIndex
CREATE INDEX "hive_escalations_raised_by_id_idx" ON "hive_escalations"("raised_by_id");

-- CreateIndex
CREATE INDEX "org_entities_head_employee_id_idx" ON "org_entities"("head_employee_id");

-- CreateIndex
CREATE INDEX "teams_head_employee_id_idx" ON "teams"("head_employee_id");

-- AddForeignKey
ALTER TABLE "org_entities" ADD CONSTRAINT "org_entities_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directorates" ADD CONSTRAINT "directorates_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_raised_by_id_fkey" FOREIGN KEY ("raised_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Leader names -> heads (unique matches only; never overwrites a head).
WITH m AS (
  SELECT i."unitId" AS unit_id, MIN(e."id") AS employee_id
  FROM "hive_org_unit_info" i
  JOIN "employees" e
    ON lower(btrim(e."name")) = lower(btrim(i."leaderName"))
   AND e."deletedAt" IS NULL
   AND e."status" <> 'LEAVER'
  WHERE i."leaderName" IS NOT NULL AND btrim(i."leaderName") <> ''
  GROUP BY i."unitId"
  HAVING COUNT(DISTINCT e."id") = 1
)
UPDATE "org_entities" u SET "head_employee_id" = m.employee_id
FROM m WHERE u."id" = m.unit_id AND u."head_employee_id" IS NULL;
WITH m AS (
  SELECT i."unitId" AS unit_id, MIN(e."id") AS employee_id
  FROM "hive_org_unit_info" i
  JOIN "employees" e
    ON lower(btrim(e."name")) = lower(btrim(i."leaderName"))
   AND e."deletedAt" IS NULL
   AND e."status" <> 'LEAVER'
  WHERE i."leaderName" IS NOT NULL AND btrim(i."leaderName") <> ''
  GROUP BY i."unitId"
  HAVING COUNT(DISTINCT e."id") = 1
)
UPDATE "directorates" u SET "head_employee_id" = m.employee_id
FROM m WHERE u."id" = m.unit_id AND u."head_employee_id" IS NULL;
WITH m AS (
  SELECT i."unitId" AS unit_id, MIN(e."id") AS employee_id
  FROM "hive_org_unit_info" i
  JOIN "employees" e
    ON lower(btrim(e."name")) = lower(btrim(i."leaderName"))
   AND e."deletedAt" IS NULL
   AND e."status" <> 'LEAVER'
  WHERE i."leaderName" IS NOT NULL AND btrim(i."leaderName") <> ''
  GROUP BY i."unitId"
  HAVING COUNT(DISTINCT e."id") = 1
)
UPDATE "departments" u SET "head_employee_id" = m.employee_id
FROM m WHERE u."id" = m.unit_id AND u."head_employee_id" IS NULL;
WITH m AS (
  SELECT i."unitId" AS unit_id, MIN(e."id") AS employee_id
  FROM "hive_org_unit_info" i
  JOIN "employees" e
    ON lower(btrim(e."name")) = lower(btrim(i."leaderName"))
   AND e."deletedAt" IS NULL
   AND e."status" <> 'LEAVER'
  WHERE i."leaderName" IS NOT NULL AND btrim(i."leaderName") <> ''
  GROUP BY i."unitId"
  HAVING COUNT(DISTINCT e."id") = 1
)
UPDATE "teams" u SET "head_employee_id" = m.employee_id
FROM m WHERE u."id" = m.unit_id AND u."head_employee_id" IS NULL;
