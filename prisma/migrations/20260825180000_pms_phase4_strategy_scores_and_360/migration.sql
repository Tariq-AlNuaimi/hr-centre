-- Phase 4 — §8.4 Strategy scores and §9 the 360 assessment module.
--
-- Hand-written, same convention as the earlier PMS migrations: the CHECK
-- constraints express clauses the Prisma schema has no way to say.

-- 1. §8.4 — the Strategy team's figures, keyed in by HR ------------------------
CREATE TABLE "entity_scores" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "score" DECIMAL(3,2) NOT NULL,
    "entered_by_employee_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entity_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "department_scores" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "score" DECIMAL(3,2) NOT NULL,
    "entered_by_employee_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "department_scores_pkey" PRIMARY KEY ("id")
);

-- §8.1 — every component resolves onto 1–5. A figure outside it is a keying
-- error, and §8.6 would carry it straight into a final score and a bonus band.
ALTER TABLE "entity_scores" ADD CONSTRAINT "entity_scores_range_check"
  CHECK ("score" >= 1 AND "score" <= 5);
ALTER TABLE "department_scores" ADD CONSTRAINT "department_scores_range_check"
  CHECK ("score" >= 1 AND "score" <= 5);

-- One figure per entity/department per CYCLE (§8.4). The cycle is part of the
-- key so last year's score survives this year's being keyed in.
CREATE UNIQUE INDEX "entity_scores_cycle_id_entity_id_key"
  ON "entity_scores" ("cycle_id", "entity_id");
CREATE UNIQUE INDEX "department_scores_cycle_id_department_id_key"
  ON "department_scores" ("cycle_id", "department_id");

ALTER TABLE "entity_scores" ADD CONSTRAINT "entity_scores_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_scores" ADD CONSTRAINT "entity_scores_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "org_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_scores" ADD CONSTRAINT "entity_scores_entered_by_fkey"
  FOREIGN KEY ("entered_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "department_scores" ADD CONSTRAINT "department_scores_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "department_scores" ADD CONSTRAINT "department_scores_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "department_scores" ADD CONSTRAINT "department_scores_entered_by_fkey"
  FOREIGN KEY ("entered_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. §9 — the 360 module ------------------------------------------------------
CREATE TYPE "ThreeSixtyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');
CREATE TYPE "AssessmentType" AS ENUM ('LINE_MANAGER_TO_EMPLOYEE', 'EMPLOYEE_TO_LINE_MANAGER', 'PEER_TO_PEER');
CREATE TYPE "AssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED');

CREATE TABLE "three_sixty_cycles" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "status" "ThreeSixtyStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "three_sixty_cycles_pkey" PRIMARY KEY ("id")
);

-- §9.1 — one 360 cycle per performance year. A second would make "the
-- employee's 360 ratio" ambiguous when §8.5 carries it into the final score.
CREATE UNIQUE INDEX "three_sixty_cycles_cycle_id_key" ON "three_sixty_cycles" ("cycle_id");

-- A window that closes before it opens is not a window (§5.4's convention).
ALTER TABLE "three_sixty_cycles" ADD CONSTRAINT "three_sixty_cycles_window_ordered_check"
  CHECK ("deadline" > "opensAt");

CREATE TABLE "assessment_templates" (
    "id" TEXT NOT NULL,
    "three_sixty_cycle_id" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assessment_templates_pkey" PRIMARY KEY ("id")
);

-- §9.2 — three types, "each with its own question template". One each.
CREATE UNIQUE INDEX "assessment_templates_cycle_type_key"
  ON "assessment_templates" ("three_sixty_cycle_id", "type");

CREATE TABLE "template_questions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "scored" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "template_questions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_text_not_blank_check"
  CHECK (btrim("text") <> '');

CREATE UNIQUE INDEX "template_questions_template_id_order_index_key"
  ON "template_questions" ("template_id", "order_index");

CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "three_sixty_cycle_id" TEXT NOT NULL,
    "ratee_id" TEXT NOT NULL,
    "rater_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "submitted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- Nobody assesses themselves. §9.4's three raters are all other people, and a
-- self-assessment already has its own home in §7.1.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_no_self_rating_check"
  CHECK ("ratee_id" <> "rater_id");

-- A SUBMITTED assignment has a submission time; an unsubmitted one has none.
-- Half a submission is not a state this table should be able to hold.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_submitted_complete_check"
  CHECK (
    ("status" = 'SUBMITTED' AND "submitted_at" IS NOT NULL)
    OR ("status" <> 'SUBMITTED' AND "submitted_at" IS NULL)
  );

-- §9.7 — "prevent duplicate submissions per assignment".
CREATE UNIQUE INDEX "assignments_cycle_ratee_rater_key"
  ON "assignments" ("three_sixty_cycle_id", "ratee_id", "rater_id");
CREATE INDEX "assignments_rater_id_status_idx" ON "assignments" ("rater_id", "status");
CREATE INDEX "assignments_cycle_ratee_idx" ON "assignments" ("three_sixty_cycle_id", "ratee_id");

CREATE TABLE "assignment_responses" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "score" INTEGER,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assignment_responses_pkey" PRIMARY KEY ("id")
);

-- §9.3 — "4-point forced scale (no neutral midpoint): Strongly Disagree = 1,
-- Disagree = 2, Agree = 3, Strongly Agree = 4." A 5 would silently import §8.1's
-- KPI scale into the 360 and inflate every ratio §9.5 computes.
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_score_range_check"
  CHECK ("score" IS NULL OR ("score" >= 1 AND "score" <= 4));

-- An answer says something: a score, or text, or both. An empty row is a
-- question that was rendered, not one that was answered — and §9.5 divides by
-- the form's maximum, so a blank counted as answered would depress the ratio.
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_not_empty_check"
  CHECK ("score" IS NOT NULL OR ("text" IS NOT NULL AND btrim("text") <> ''));

CREATE UNIQUE INDEX "assignment_responses_assignment_id_question_id_key"
  ON "assignment_responses" ("assignment_id", "question_id");

CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "projects" ADD CONSTRAINT "projects_name_not_blank_check"
  CHECK (btrim("name") <> '');

CREATE UNIQUE INDEX "projects_cycle_id_name_key" ON "projects" ("cycle_id", "name");

CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_members_project_id_employee_id_key"
  ON "project_members" ("project_id", "employee_id");

-- Foreign keys
ALTER TABLE "three_sixty_cycles" ADD CONSTRAINT "three_sixty_cycles_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_cycle_fkey"
  FOREIGN KEY ("three_sixty_cycle_id") REFERENCES "three_sixty_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cycle_fkey"
  FOREIGN KEY ("three_sixty_cycle_id") REFERENCES "three_sixty_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ratee_id_fkey"
  FOREIGN KEY ("ratee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_rater_id_fkey"
  FOREIGN KEY ("rater_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "template_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
