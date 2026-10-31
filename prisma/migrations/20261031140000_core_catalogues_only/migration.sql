-- ADR-103: an employee's grade IS a core catalogue row. The legacy free-text
-- `employees.grade` and the trigger that kept `grade_id` in step with it go.
--
-- 1. No value is lost: any employee whose written grade has no live link (its
--    catalogue grade was removed since, or never matched) gets a catalogue row
--    for that company (name = code, no band, after the curated grades), exactly
--    as the ADR-097 migration did, and is linked to it.
INSERT INTO "core_grades" ("id", "code", "name", "order", "entityId", "createdAt", "updatedAt")
SELECT 'empg_' || md5(e."entityId" || ':' || lower(btrim(e."grade"))), min(btrim(e."grade")), min(btrim(e."grade")), 1000, e."entityId", now(), now()
FROM "employees" e
WHERE e."grade" IS NOT NULL AND btrim(e."grade") <> ''
  AND (e."grade_id" IS NULL OR EXISTS (
    SELECT 1 FROM "core_grades" d WHERE d."id" = e."grade_id" AND d."deletedAt" IS NOT NULL))
  AND NOT EXISTS (
    SELECT 1 FROM "core_grades" g
    WHERE g."deletedAt" IS NULL AND lower(g."code") = lower(btrim(e."grade"))
      AND (g."entityId" = e."entityId" OR g."entityId" IS NULL))
GROUP BY e."entityId", lower(btrim(e."grade"))
ON CONFLICT ("id") DO NOTHING;

UPDATE "employees" e SET "grade_id" = core_employee_grade_id(e."grade", e."entityId")
WHERE e."grade" IS NOT NULL AND btrim(e."grade") <> ''
  AND (e."grade_id" IS NULL OR EXISTS (
    SELECT 1 FROM "core_grades" d WHERE d."id" = e."grade_id" AND d."deletedAt" IS NOT NULL));

-- 2. Refuse to drop the column if anything would still be lost.
DO $$
DECLARE unlinked INTEGER;
BEGIN
  SELECT count(*) INTO unlinked FROM "employees" e
  WHERE e."grade" IS NOT NULL AND btrim(e."grade") <> '' AND e."grade_id" IS NULL;
  IF unlinked > 0 THEN
    RAISE EXCEPTION 'ADR-103: % employee grade(s) could not be linked to the catalogue', unlinked;
  END IF;
END $$;

-- 3. The trigger, its functions and the column.
DROP TRIGGER IF EXISTS "employees_link_grade" ON "employees";
DROP FUNCTION IF EXISTS core_link_employee_grade();
DROP FUNCTION IF EXISTS core_employee_grade_id(TEXT, TEXT);
ALTER TABLE "employees" DROP COLUMN "grade";

-- 4. Performance 360 questions name the competency they assess from the shared
--    core catalogue (optional; scoring unchanged).
ALTER TABLE "template_questions" ADD COLUMN "competency_id" TEXT;
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "core_competencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Legacy stores whose data moved to core tables (ADR-094 follow-up, ADR-102),
--    now that the core paths are deployed and verified live.
--
--    JML's assignment rules: a last idempotent sweep (anything an old instance
--    wrote while the switching deploy rolled out), then the table goes.
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
DROP TABLE "jml_hr_assignment_rules";

--    Requisition approvals and JD sign-offs: dropped only when every legacy row
--    is represented in the core engine (copied by 20261031100000 with its own
--    id). A row written after that copy would be left in place, never lost.
DO $$
DECLARE missing INTEGER;
BEGIN
  SELECT
    (SELECT count(*) FROM "hiring_requisition_approvals" a
      WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."approverId")
        AND NOT EXISTS (SELECT 1 FROM "core_approval_decisions" d WHERE d."id" = a."id"))
    +
    (SELECT count(*) FROM "hiring_jd_signoffs" s
      WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = s."actorId")
        AND NOT EXISTS (SELECT 1 FROM "core_approval_decisions" d WHERE d."id" = s."id"))
  INTO missing;
  IF missing = 0 THEN
    DROP TABLE "hiring_requisition_approvals";
    DROP TABLE "hiring_jd_signoffs";
    DROP TYPE "HiringJdSignoffAction";
  ELSE
    RAISE NOTICE 'ADR-094: % legacy approval row(s) not in the core engine; legacy tables kept', missing;
  END IF;
END $$;
