-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CycleStageKind" AS ENUM ('GOAL_SETTING', 'MID_YEAR', 'YEAR_END');

-- CreateEnum
CREATE TYPE "SignOffParty" AS ENUM ('EMPLOYEE', 'MANAGER');

-- CreateEnum
CREATE TYPE "ComplianceKind" AS ENUM ('REMINDER_SENT', 'DEADLINE_MISSED', 'ESCALATED_SKIP_LEVEL', 'ESCALATED_HR', 'HR_EXTENDED_DEADLINE', 'HR_MARKED_NON_COMPLIANT');

-- ---------------------------------------------------------------------------
-- THREE STATEMENTS WERE REMOVED FROM THE GENERATED DIFF. Read this before
-- regenerating a migration in a later phase, because the generator will propose
-- them again every single time.
--
-- `prisma migrate diff` compares the database against the PRISMA SCHEMA, and the
-- schema cannot express a composite foreign key. Phase 1 therefore hand-wrote
-- two objects into its migration that the schema does not know about, so every
-- subsequent diff sees them as drift and proposes dropping them:
--
--   ALTER TABLE "employees" DROP CONSTRAINT "employees_department_entity_agree_fkey";
--   DROP INDEX "departments_id_entity_key";
--
-- Those two ARE §1.2's agreement invariant — "an employee in RIHAL cannot point
-- at a TP department". Applying them would silently delete the only thing
-- enforcing it, and the denormalised `employees.entityId` would be free to drift
-- from its department's. The index is not incidental either: the constraint
-- depends on it, which is why Postgres refuses to drop it first.
--
-- The third was:
--
--   DROP TABLE "document_embedding";
--
-- a template-inherited table that no longer appears in the schema. Removing it
-- may well be correct, but it is unrelated to Phase 2 and dropping a table is
-- not a side effect a cycle migration should carry. It stays for a deliberate
-- cleanup with its own reasoning.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "performance_cycles" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "opened_by_id" TEXT,
    "opened_at" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_stages" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "kind" "CycleStageKind" NOT NULL,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_participants" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "goals_approved_at" TIMESTAMP(3),
    "goals_approved_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_events" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "stage_kind" "CycleStageKind" NOT NULL,
    "subject_employee_id" TEXT NOT NULL,
    "manager_employee_id" TEXT,
    "kind" "ComplianceKind" NOT NULL,
    "missed_by_hours" INTEGER,
    "detail" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_offs" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "party" "SignOffParty" NOT NULL,
    "signed_by_employee_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpis" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weightage" DECIMAL(5,2) NOT NULL,
    "descriptor_outstanding" TEXT NOT NULL,
    "descriptor_excellent" TEXT NOT NULL,
    "descriptor_target" TEXT NOT NULL,
    "descriptor_almost_achieved" TEXT NOT NULL,
    "descriptor_unsatisfactory" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_cycles_year_key" ON "performance_cycles"("year");

-- CreateIndex
CREATE INDEX "performance_cycles_status_year_idx" ON "performance_cycles"("status", "year");

-- CreateIndex
CREATE INDEX "performance_cycles_deletedAt_createdAt_idx" ON "performance_cycles"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "cycle_stages_cycle_id_deadline_idx" ON "cycle_stages"("cycle_id", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_stages_cycle_id_kind_key" ON "cycle_stages"("cycle_id", "kind");

-- CreateIndex
CREATE INDEX "cycle_participants_employee_id_idx" ON "cycle_participants"("employee_id");

-- CreateIndex
CREATE INDEX "cycle_participants_cycle_id_goals_approved_at_idx" ON "cycle_participants"("cycle_id", "goals_approved_at");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_participants_cycle_id_employee_id_key" ON "cycle_participants"("cycle_id", "employee_id");

-- CreateIndex
CREATE INDEX "compliance_events_cycle_id_kind_idx" ON "compliance_events"("cycle_id", "kind");

-- CreateIndex
CREATE INDEX "compliance_events_manager_employee_id_occurred_at_idx" ON "compliance_events"("manager_employee_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_events_cycle_id_stage_kind_subject_employee_id_k_key" ON "compliance_events"("cycle_id", "stage_kind", "subject_employee_id", "kind");

-- CreateIndex
CREATE INDEX "sign_offs_signed_by_employee_id_idx" ON "sign_offs"("signed_by_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "sign_offs_participant_id_party_key" ON "sign_offs"("participant_id", "party");

-- CreateIndex
CREATE INDEX "kpis_participant_id_order_index_idx" ON "kpis"("participant_id", "order_index");

-- CreateIndex
CREATE INDEX "kpis_deletedAt_createdAt_idx" ON "kpis"("deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_stages" ADD CONSTRAINT "cycle_stages_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_participants" ADD CONSTRAINT "cycle_participants_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_participants" ADD CONSTRAINT "cycle_participants_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_participants" ADD CONSTRAINT "cycle_participants_goals_approved_by_id_fkey" FOREIGN KEY ("goals_approved_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_subject_employee_id_fkey" FOREIGN KEY ("subject_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_manager_employee_id_fkey" FOREIGN KEY ("manager_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_offs" ADD CONSTRAINT "sign_offs_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "cycle_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_offs" ADD CONSTRAINT "sign_offs_signed_by_employee_id_fkey" FOREIGN KEY ("signed_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "cycle_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants. Prisma cannot express these, and each one guards a
-- rule the spec states in prose. Same approach as the Phase 1 migration: the
-- database refuses the impossible state rather than trusting every future call
-- site to remember it.
-- ---------------------------------------------------------------------------

-- §5.2 — weightage is a percentage. A set must total exactly 100 (§5.3), which
-- is a SET-level rule enforced at sign-off in lib/pms/kpi.ts; this is the
-- per-row floor that stops a negative or >100 weight ever being stored.
ALTER TABLE "kpis"
  ADD CONSTRAINT "kpis_weightage_range_check"
  CHECK ("weightage" >= 0 AND "weightage" <= 100);

-- A KPI with a blank description or a blank descriptor is not a KPI: §5.2 says
-- the manager authors all six texts. Empty strings would satisfy NOT NULL while
-- meaning nothing, and would reach the employee as an unlabelled rating scale.
ALTER TABLE "kpis"
  ADD CONSTRAINT "kpis_texts_not_blank_check"
  CHECK (
    length(btrim("description")) > 0
    AND length(btrim("descriptor_outstanding")) > 0
    AND length(btrim("descriptor_excellent")) > 0
    AND length(btrim("descriptor_target")) > 0
    AND length(btrim("descriptor_almost_achieved")) > 0
    AND length(btrim("descriptor_unsatisfactory")) > 0
  );

-- §5.4 — a stage opens and then closes. A deadline at or before the open would
-- make the stage permanently locked the instant it was created, which reads to
-- a manager as the system being broken rather than as a mis-set date.
ALTER TABLE "cycle_stages"
  ADD CONSTRAINT "cycle_stages_window_ordered_check"
  CHECK ("deadline" > "opens_at");

-- §5.5 — the grace window is a duration before HR intervenes. Negative is
-- meaningless; the upper bound stops a typo (30 vs 3) silently parking an
-- escalation for a month, which on a December deadline is past the cycle.
ALTER TABLE "cycle_stages"
  ADD CONSTRAINT "cycle_stages_grace_days_range_check"
  CHECK ("grace_days" >= 0 AND "grace_days" <= 30);

-- §5.1 — HR approval IS the lock, and it is one act: an approver without a
-- timestamp, or a timestamp without an approver, is a half-locked baseline that
-- no reader could interpret.
ALTER TABLE "cycle_participants"
  ADD CONSTRAINT "cycle_participants_approval_complete_check"
  CHECK (
    ("goals_approved_at" IS NULL AND "goals_approved_by_id" IS NULL)
    OR ("goals_approved_at" IS NOT NULL AND "goals_approved_by_id" IS NOT NULL)
  );

-- §5.6 — "by how long" is a duration, never negative.
ALTER TABLE "compliance_events"
  ADD CONSTRAINT "compliance_events_missed_by_nonneg_check"
  CHECK ("missed_by_hours" IS NULL OR "missed_by_hours" >= 0);

-- A performance year, not a typo. Guards 20027 and 227 alike.
ALTER TABLE "performance_cycles"
  ADD CONSTRAINT "performance_cycles_year_range_check"
  CHECK ("year" >= 2000 AND "year" <= 2100);
