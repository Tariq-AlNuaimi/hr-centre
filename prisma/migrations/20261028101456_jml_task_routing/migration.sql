-- JML task routing (docs/blueprints/jml-task-routing.md).
-- Template tasks and case tasks carry an assignee role; the IT and Finance desks
-- are named users (jml_desk_members). Additive only: every existing row reads HR.

-- CreateEnum
CREATE TYPE "JmlAssigneeRole" AS ENUM ('HR', 'LINE_MANAGER', 'IT', 'FINANCE');

-- CreateEnum
CREATE TYPE "JmlTaskDesk" AS ENUM ('IT', 'FINANCE');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'JML_TASK_ASSIGNED';

-- AlterTable
ALTER TABLE "jml_tasks" ADD COLUMN     "assignee_role" "JmlAssigneeRole" NOT NULL DEFAULT 'HR';

-- AlterTable
ALTER TABLE "jml_template_tasks" ADD COLUMN     "assignee_role" "JmlAssigneeRole" NOT NULL DEFAULT 'HR';

-- CreateTable
CREATE TABLE "jml_desk_members" (
    "id" TEXT NOT NULL,
    "desk" "JmlTaskDesk" NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jml_desk_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jml_desk_members_user_id_idx" ON "jml_desk_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "jml_desk_members_desk_user_id_key" ON "jml_desk_members"("desk", "user_id");

-- CreateIndex
CREATE INDEX "jml_tasks_assignee_role_status_idx" ON "jml_tasks"("assignee_role", "status");

-- AddForeignKey
ALTER TABLE "jml_desk_members" ADD CONSTRAINT "jml_desk_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill the assignee role on the template rows ALREADY seeded (production).
-- Generated from prisma/seed-jml-routing.ts (a contract test keeps them equal).
-- Matched on template name + code + the seeded task name, and only while the
-- row still reads HR, so a task HR renamed or re-routed is left alone. Fresh
-- databases get the same roles from the seed, which runs after migrations.
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T20' AND tt."name" = 'Welcome employee' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T22' AND tt."name" = 'Hand over laptop' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T23' AND tt."name" = 'Confirm credentials shared' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T24' AND tt."name" = 'Confirm access card issued' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T40' AND tt."name" = 'Add employee to payroll sheet when Payroll Applicable = Yes' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Standard onboarding (§10.2 starter)' AND tt."code" = 'T43' AND tt."name" = 'Add employee to employee distribution list' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Internship to training (starter)' AND tt."code" = 'T20' AND tt."name" = 'Add employee to payroll sheet when Payroll Applicable = Yes' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Internship to training (starter)' AND tt."code" = 'T21' AND tt."name" = 'Agree training plan with line manager' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Internship to employment (starter)' AND tt."code" = 'T20' AND tt."name" = 'Add employee to payroll sheet when Payroll Applicable = Yes' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Training to employment (starter)' AND tt."code" = 'T20' AND tt."name" = 'Add employee to payroll sheet when Payroll Applicable = Yes' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Department transfer (starter)' AND tt."code" = 'T20' AND tt."name" = 'Update employee distribution lists' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Department transfer (starter)' AND tt."code" = 'T21' AND tt."name" = 'Complete handover from previous department' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S1-05' AND tt."name" = 'Execute immediate access revocation and asset recovery before notification' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S1-07' AND tt."name" = 'Line Manager and management confirm the exit' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-02' AND tt."name" = 'Confirm handover completion with the line manager, stating that the receiving employee has accepted the handover' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-04' AND tt."name" = 'IT confirms access revocation complete, with dated confirmation and reference' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-05' AND tt."name" = 'IT confirms shared and service credentials known to the employee have been rotated' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-06' AND tt."name" = 'Confirm company asset return to IT with condition check recorded' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-07' AND tt."name" = 'Instruct IT to disable the email account' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-08' AND tt."name" = 'Instruct IT to remove the employee from email distribution lists' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S3-09' AND tt."name" = 'Execute mailbox and file disposition: delegation, transfer and retention' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Full' AND tt."code" = 'S4-06' AND tt."name" = 'Confirm settlement payment executed and record payment reference' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S1-05' AND tt."name" = 'Execute immediate access revocation and asset recovery before notification' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S1-07' AND tt."name" = 'Line Manager and management confirm the exit' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'LINE_MANAGER' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-02' AND tt."name" = 'Confirm handover completion with the line manager, stating that the receiving employee has accepted the handover' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-04' AND tt."name" = 'IT confirms access revocation complete, with dated confirmation and reference' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-05' AND tt."name" = 'IT confirms shared and service credentials known to the employee have been rotated' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-06' AND tt."name" = 'Confirm company asset return to IT with condition check recorded' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-07' AND tt."name" = 'Instruct IT to disable the email account' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-08' AND tt."name" = 'Instruct IT to remove the employee from email distribution lists' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'IT' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S3-09' AND tt."name" = 'Execute mailbox and file disposition: delegation, transfer and retention' AND tt."assignee_role" = 'HR';
UPDATE "jml_template_tasks" AS tt SET "assignee_role" = 'FINANCE' FROM "jml_task_templates" AS t WHERE tt."template_id" = t."id" AND t."name" = 'Baseline offboarding — Light' AND tt."code" = 'S4-06' AND tt."name" = 'Confirm settlement payment executed and record payment reference' AND tt."assignee_role" = 'HR';
