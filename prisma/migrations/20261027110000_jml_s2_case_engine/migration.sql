-- JML S2 (docs/blueprints/jml.md): the case engine.
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TYPE "JmlCaseType" AS ENUM ('JOIN', 'MOVE', 'LEAVE');

CREATE TYPE "JmlCaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'AT_RISK', 'PENDING_SETTLEMENT', 'COMPLETED', 'CLOSED', 'CANCELLED', 'ARCHIVED');

CREATE TYPE "JmlStage" AS ENUM ('PREBOARDING', 'FIRST_DAY', 'FIRST_WEEK', 'COMPLETED', 'STAGE_1_RESIGNATION', 'STAGE_2_IMMEDIATE', 'STAGE_3_NOTICE_HANDOVER', 'STAGE_4_SETTLEMENT');

CREATE TYPE "JmlTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING_FOR_EMPLOYEE', 'WAITING_FOR_IT', 'WAITING_FOR_PRO', 'WAITING_FOR_EXTERNAL', 'WAITING_FOR_LINE_MANAGER', 'WAITING_FOR_FINANCE', 'WAITING_FOR_ADMIN', 'WAITING_FOR_MOL_COORDINATOR', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'NOT_APPLICABLE', 'DELAYED', 'CANCELLED');

CREATE TYPE "JmlTaskSource" AS ENUM ('TEMPLATE', 'MANUAL', 'REVERSAL');

CREATE TYPE "JmlDateBasis" AS ENUM ('START_DATE', 'EFFECTIVE_DATE', 'NOTICE_START', 'LAST_PHYSICAL_WORKING_DAY', 'LAST_DAY_OF_SERVICE', 'DEPARTURE_DATE');

CREATE TYPE "JmlOffsetUnit" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');

CREATE TYPE "JmlComplianceCategory" AS ENUM ('ROP_CLEARANCE', 'VISA', 'MOL', 'OTHER');

CREATE TYPE "JmlRuleScope" AS ENUM ('COMPANY', 'DIRECTORATE', 'DEPARTMENT');

CREATE TYPE "JmlEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'CANCELLED');

CREATE TYPE "JmlRagFlag" AS ENUM ('GREEN', 'AMBER', 'RED');

CREATE TYPE "JmlChangeType" AS ENUM ('INTERNSHIP_TO_TRAINING', 'INTERNSHIP_TO_EMPLOYMENT', 'TRAINING_TO_EMPLOYMENT', 'DEPARTMENT_TRANSFER');

CREATE TYPE "LeaveExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'CONTRACT_EXPIRY', 'PROBATION_EXIT', 'SUMMARY_DISMISSAL');

CREATE TYPE "JmlEmploymentScope" AS ENUM ('FULL', 'LIGHT', 'ANY');

CREATE TYPE "JmlNationalityScope" AS ENUM ('OMANI', 'EXPATRIATE', 'ANY');

ALTER TYPE "NotificationKind" ADD VALUE 'JML_INFO';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_AUTOMATION_FAILURE';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_OVERDUE_TASK_DIGEST';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_OVERDUE_ESCALATION';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_STATUTORY_WATCH_ALERT';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_APPROVAL_REMINDER';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_CASE_ACTIVATED';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_RECALCULATION_NOTICE';

ALTER TYPE "NotificationKind" ADD VALUE 'JML_CASE_CLOSED';

ALTER TABLE "notifications" ADD COLUMN     "case_id" TEXT,
ADD COLUMN     "dismissed_at" TIMESTAMP(3),
ADD COLUMN     "send_after" TIMESTAMP(3);

CREATE TABLE "jml_cases" (
    "id" TEXT NOT NULL,
    "case_ref" TEXT NOT NULL,
    "case_type" "JmlCaseType" NOT NULL,
    "status" "JmlCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "stage" "JmlStage" NOT NULL,
    "employee_id" TEXT NOT NULL,
    "hr_owner_user_id" TEXT,
    "senior_hr_user_id" TEXT,
    "template_id" TEXT,
    "completion_pct" INTEGER NOT NULL DEFAULT 0,
    "rag_flag" "JmlRagFlag" NOT NULL DEFAULT 'GREEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "duplicate_override_reason" TEXT,
    "archived_at" TIMESTAMP(3),
    "archived_by_id" TEXT,
    "last_updated_by_id" TEXT,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    "legal_hold_at" TIMESTAMP(3),
    "legal_hold_by_id" TEXT,
    "anonymised_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_task_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "case_type" "JmlCaseType" NOT NULL,
    "change_type" "JmlChangeType",
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "employment_scope" "JmlEmploymentScope" NOT NULL DEFAULT 'ANY',
    "nationality_scope" "JmlNationalityScope" NOT NULL DEFAULT 'ANY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_task_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_template_tasks" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "JmlStage" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "date_basis" "JmlDateBasis" NOT NULL,
    "offset_days" INTEGER NOT NULL DEFAULT 0,
    "offset_unit" "JmlOffsetUnit" NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_required" BOOLEAN NOT NULL DEFAULT false,
    "default_confirming_party" TEXT,
    "reversal_flag" BOOLEAN NOT NULL DEFAULT false,
    "depends_on_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statutory" BOOLEAN NOT NULL DEFAULT false,
    "compliance_category" "JmlComplianceCategory",
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "applies_to_exit_types" "LeaveExitType"[] DEFAULT ARRAY[]::"LeaveExitType"[],
    "applies_to_nationality" "JmlNationalityScope" NOT NULL DEFAULT 'ANY',
    "applies_to_settlement" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_template_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_tasks" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "JmlStage" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" "JmlTaskSource" NOT NULL DEFAULT 'TEMPLATE',
    "status" "JmlTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "date_basis" "JmlDateBasis",
    "offset_days" INTEGER,
    "offset_unit" "JmlOffsetUnit",
    "due_date" DATE,
    "due_date_override_reason" TEXT,
    "owner_user_id" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_required" BOOLEAN NOT NULL DEFAULT false,
    "confirming_party" TEXT,
    "confirmation_date" DATE,
    "external_reference" TEXT,
    "reversal_flag" BOOLEAN NOT NULL DEFAULT false,
    "is_reversal" BOOLEAN NOT NULL DEFAULT false,
    "reversal_of_id" TEXT,
    "depends_on_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "not_applicable_reason" TEXT,
    "delay_reason" TEXT,
    "statutory" BOOLEAN NOT NULL DEFAULT false,
    "compliance_category" "JmlComplianceCategory",
    "compliance_deadline" DATE,
    "condition_source" JSONB,
    "last_reminder_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jml_task_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_hr_assignment_rules" (
    "id" TEXT NOT NULL,
    "scope" "JmlRuleScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "case_types" "JmlCaseType"[] DEFAULT ARRAY[]::"JmlCaseType"[],
    "junior_hr_user_id" TEXT NOT NULL,
    "senior_hr_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_hr_assignment_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_contract_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_contract_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_employment_type_configs" (
    "id" TEXT NOT NULL,
    "employment_type" "ContractType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "default_template_id" TEXT,
    "payroll_applicable_default" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_employment_type_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_email_logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "status" "JmlEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "case_id" TEXT,
    "sent_by_id" TEXT,
    "resend_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_email_template_overrides" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "cc_recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_email_template_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "jml_cases_case_ref_key" ON "jml_cases"("case_ref");

CREATE INDEX "jml_cases_deleted_at_created_at_idx" ON "jml_cases"("deleted_at", "created_at");

CREATE INDEX "jml_cases_case_type_status_idx" ON "jml_cases"("case_type", "status");

CREATE INDEX "jml_cases_status_stage_idx" ON "jml_cases"("status", "stage");

CREATE INDEX "jml_cases_hr_owner_user_id_status_idx" ON "jml_cases"("hr_owner_user_id", "status");

CREATE INDEX "jml_cases_employee_id_case_type_status_idx" ON "jml_cases"("employee_id", "case_type", "status");

CREATE INDEX "jml_cases_status_legal_hold_anonymised_at_idx" ON "jml_cases"("status", "legal_hold", "anonymised_at");

CREATE INDEX "jml_task_templates_case_type_change_type_active_idx" ON "jml_task_templates"("case_type", "change_type", "active");

CREATE UNIQUE INDEX "jml_task_templates_name_version_key" ON "jml_task_templates"("name", "version");

CREATE INDEX "jml_template_tasks_template_id_stage_sort_order_idx" ON "jml_template_tasks"("template_id", "stage", "sort_order");

CREATE UNIQUE INDEX "jml_template_tasks_template_id_code_key" ON "jml_template_tasks"("template_id", "code");

CREATE UNIQUE INDEX "jml_tasks_reversal_of_id_key" ON "jml_tasks"("reversal_of_id");

CREATE INDEX "jml_tasks_case_id_stage_sort_order_idx" ON "jml_tasks"("case_id", "stage", "sort_order");

CREATE INDEX "jml_tasks_status_due_date_idx" ON "jml_tasks"("status", "due_date");

CREATE INDEX "jml_tasks_owner_user_id_status_due_date_idx" ON "jml_tasks"("owner_user_id", "status", "due_date");

CREATE INDEX "jml_tasks_statutory_compliance_deadline_idx" ON "jml_tasks"("statutory", "compliance_deadline");

CREATE UNIQUE INDEX "jml_tasks_case_id_code_key" ON "jml_tasks"("case_id", "code");

CREATE INDEX "jml_task_comments_task_id_created_at_idx" ON "jml_task_comments"("task_id", "created_at");

CREATE INDEX "jml_hr_assignment_rules_active_scope_priority_idx" ON "jml_hr_assignment_rules"("active", "scope", "priority");

CREATE INDEX "jml_hr_assignment_rules_scope_id_idx" ON "jml_hr_assignment_rules"("scope_id");

CREATE UNIQUE INDEX "jml_contract_types_name_key" ON "jml_contract_types"("name");

CREATE UNIQUE INDEX "jml_contract_types_code_key" ON "jml_contract_types"("code");

CREATE INDEX "jml_contract_types_active_sort_order_idx" ON "jml_contract_types"("active", "sort_order");

CREATE UNIQUE INDEX "jml_employment_type_configs_employment_type_key" ON "jml_employment_type_configs"("employment_type");

CREATE INDEX "jml_email_logs_status_scheduled_for_idx" ON "jml_email_logs"("status", "scheduled_for");

CREATE INDEX "jml_email_logs_case_id_created_at_idx" ON "jml_email_logs"("case_id", "created_at");

CREATE UNIQUE INDEX "jml_email_template_overrides_type_key" ON "jml_email_template_overrides"("type");

CREATE INDEX "notifications_case_id_idx" ON "notifications"("case_id");

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_hr_owner_user_id_fkey" FOREIGN KEY ("hr_owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_senior_hr_user_id_fkey" FOREIGN KEY ("senior_hr_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "jml_task_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_last_updated_by_id_fkey" FOREIGN KEY ("last_updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_cases" ADD CONSTRAINT "jml_cases_legal_hold_by_id_fkey" FOREIGN KEY ("legal_hold_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_template_tasks" ADD CONSTRAINT "jml_template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "jml_task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_tasks" ADD CONSTRAINT "jml_tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_tasks" ADD CONSTRAINT "jml_tasks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_tasks" ADD CONSTRAINT "jml_tasks_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "jml_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_tasks" ADD CONSTRAINT "jml_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_task_comments" ADD CONSTRAINT "jml_task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "jml_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_task_comments" ADD CONSTRAINT "jml_task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_hr_assignment_rules" ADD CONSTRAINT "jml_hr_assignment_rules_junior_hr_user_id_fkey" FOREIGN KEY ("junior_hr_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_hr_assignment_rules" ADD CONSTRAINT "jml_hr_assignment_rules_senior_hr_user_id_fkey" FOREIGN KEY ("senior_hr_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_email_logs" ADD CONSTRAINT "jml_email_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_email_logs" ADD CONSTRAINT "jml_email_logs_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_email_logs" ADD CONSTRAINT "jml_email_logs_resend_of_id_fkey" FOREIGN KEY ("resend_of_id") REFERENCES "jml_email_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_email_template_overrides" ADD CONSTRAINT "jml_email_template_overrides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One onboarding per person (Onboarding onboardingOfId @unique), ignoring cancelled
-- and discarded drafts; one ACTIVE internal change at a time (Onboarding R5); one
-- open exit case per person. Partial indexes Prisma cannot express — the services
-- check first and these settle the race.
CREATE UNIQUE INDEX "jml_cases_one_join_per_employee" ON "jml_cases"("employee_id")
  WHERE "case_type" = 'JOIN' AND "status" <> 'CANCELLED' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "jml_cases_one_active_move_per_employee" ON "jml_cases"("employee_id")
  WHERE "case_type" = 'MOVE' AND "status" = 'ACTIVE' AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "jml_cases_one_open_leave_per_employee" ON "jml_cases"("employee_id")
  WHERE "case_type" = 'LEAVE' AND "status" NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED') AND "deleted_at" IS NULL;
