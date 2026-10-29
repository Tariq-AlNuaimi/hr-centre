-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "grade_id" TEXT;

-- CreateTable
CREATE TABLE "core_grades" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSalary" DECIMAL(12,3),
    "maxSalary" DECIMAL(12,3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "entityId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_competencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT,
    "category" TEXT,
    "roleFamily" TEXT,
    "entityId" TEXT,
    "anchors" JSONB,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_grades_deletedAt_createdAt_idx" ON "core_grades"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "core_grades_code_idx" ON "core_grades"("code");

-- CreateIndex
CREATE INDEX "core_grades_entityId_code_idx" ON "core_grades"("entityId", "code");

-- CreateIndex
CREATE INDEX "core_competencies_deletedAt_createdAt_idx" ON "core_competencies"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "core_competencies_name_idx" ON "core_competencies"("name");

-- CreateIndex
CREATE INDEX "employees_grade_id_idx" ON "employees"("grade_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "core_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ADR-097: the Hiring catalogues become core, ids kept (requisitions, insights
-- and anchors that name them keep resolving). Every row is copied, including
-- soft-deleted ones (the recycling bin can still restore them). The Hiring
-- tables stay until the new path is verified live.
INSERT INTO "core_grades" ("id", "code", "name", "minSalary", "maxSalary", "order", "entityId", "deletedAt", "deletedBy", "createdAt", "updatedAt")
SELECT "id", "code", "name", "minSalary", "maxSalary", "order", "entityId", "deletedAt", "deletedBy", "createdAt", "updatedAt"
FROM "hiring_grades"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "core_competencies" ("id", "name", "definition", "category", "roleFamily", "entityId", "anchors", "deletedAt", "deletedBy", "createdAt", "updatedAt")
SELECT "id", "name", "definition", "category", "roleFamily", "entityId", "anchors", "deletedAt", "deletedBy", "createdAt", "updatedAt"
FROM "hiring_competencies"
ON CONFLICT ("id") DO NOTHING;

-- Employee grades: every grade an employee holds gets a catalogue row (a code
-- the catalogue does not know yet is added for that company, name = code, no
-- band), so no existing value is lost or left unlinked.
INSERT INTO "core_grades" ("id", "code", "name", "order", "entityId", "createdAt", "updatedAt")
SELECT 'emp_' || md5(e."entityId" || ':' || lower(btrim(e."grade"))), min(btrim(e."grade")), min(btrim(e."grade")), 1000, e."entityId", now(), now()
FROM "employees" e
WHERE e."grade" IS NOT NULL AND btrim(e."grade") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "core_grades" g
    WHERE g."deletedAt" IS NULL AND lower(g."code") = lower(btrim(e."grade"))
      AND (g."entityId" = e."entityId" OR g."entityId" IS NULL))
GROUP BY e."entityId", lower(btrim(e."grade"))
ON CONFLICT ("id") DO NOTHING;

-- The link, kept in step on every write by every writer (import, form, joiner,
-- hiring hand-over): the company's own grade first, then a group-wide one.
CREATE OR REPLACE FUNCTION core_employee_grade_id(grade TEXT, entity TEXT) RETURNS TEXT AS $$
  SELECT g."id" FROM "core_grades" g
  WHERE grade IS NOT NULL AND btrim(grade) <> '' AND g."deletedAt" IS NULL
    AND lower(g."code") = lower(btrim(grade))
    AND (g."entityId" = entity OR g."entityId" IS NULL)
  ORDER BY (g."entityId" IS NULL), g."order", g."id"
  LIMIT 1
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION core_link_employee_grade() RETURNS trigger AS $$
BEGIN
  NEW."grade_id" := core_employee_grade_id(NEW."grade", NEW."entityId");
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employees_link_grade"
  BEFORE INSERT OR UPDATE OF "grade", "entityId" ON "employees"
  FOR EACH ROW EXECUTE FUNCTION core_link_employee_grade();

UPDATE "employees" SET "grade_id" = core_employee_grade_id("grade", "entityId")
WHERE "grade" IS NOT NULL;

-- Platform AI settings (ADR-097): provider, key, limits move from Hiring to the
-- platform. The sealed key's envelope context is the key NAME, so it still opens.
UPDATE "core_module_settings" SET "module" = 'platform'
WHERE "module" = 'hiring' AND "key" IN ('ai.provider', 'ai.baseUrl', 'ai.model', 'ai.apiKey',
  'ai.pdfVision', 'ai.killSwitch', 'ai.dailyTokenCap', 'ai.dailySpendCap', 'ai.timeoutMs',
  'ai.pricePer1kIn', 'ai.pricePer1kOut');
