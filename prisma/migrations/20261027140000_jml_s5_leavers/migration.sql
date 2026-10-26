-- JML S5 — leavers part 1 (docs/blueprints/jml-s5-leavers.md)
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TYPE "LeaveExitSubtype" AS ENUM ('PERFORMANCE', 'CONDUCT', 'BUSINESS', 'OTHER');

CREATE TYPE "LeaveNationality" AS ENUM ('OMANI', 'EXPATRIATE');

CREATE TYPE "LeaveBackfillDecision" AS ENUM ('BACKFILL', 'RELEASE', 'DEFERRED', 'PENDING');

CREATE TYPE "LeaveRehireEligibility" AS ENUM ('YES', 'CONDITIONAL', 'NO');

CREATE TYPE "JmlApprovalType" AS ENUM ('EXIT_CONFIRMATION', 'TERMINATION_AUTHORISATION', 'EARLY_RELEASE_VIA_LEAVE', 'BACKFILL_DECISION', 'FINAL_SETTLEMENT_APPROVAL');

CREATE TYPE "JmlApprovalStatus" AS ENUM ('PENDING', 'GRANTED', 'REJECTED');

CREATE TYPE "JmlAccessDomain" AS ENUM ('IDENTITY', 'COMMUNICATION', 'NETWORK', 'CODE_AND_INFRASTRUCTURE', 'DATA', 'THIRD_PARTY_AND_SAAS', 'SHARED_CREDENTIALS', 'PHYSICAL', 'EXTERNAL_FACING');

CREATE TYPE "JmlAccessDirection" AS ENUM ('GRANT', 'REVOKE');

CREATE TABLE "leave_case_details" (
    "case_id" TEXT NOT NULL,
    "exit_type" "LeaveExitType" NOT NULL,
    "exit_subtype" "LeaveExitSubtype",
    "employment_type_at_exit" "ContractType",
    "nationality" "LeaveNationality" NOT NULL,
    "notice_start_date" DATE NOT NULL,
    "notice_period_days" INTEGER NOT NULL,
    "notice_period_override_reason" TEXT,
    "last_physical_working_day" DATE,
    "last_day_of_service" DATE,
    "departure_date" DATE,
    "early_release_approved" BOOLEAN NOT NULL DEFAULT false,
    "settlement_applicable" BOOLEAN NOT NULL DEFAULT true,
    "visa_support_applicable" BOOLEAN NOT NULL DEFAULT false,
    "doc_ref_performance_history" TEXT,
    "doc_ref_written_grounds" TEXT,
    "doc_ref_legal_review" TEXT,
    "backfill_decision" "LeaveBackfillDecision" NOT NULL DEFAULT 'PENDING',
    "backfill_approval_ref" TEXT,
    "rehire_eligible" "LeaveRehireEligibility",
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "manually_created" BOOLEAN NOT NULL DEFAULT true,
    "employee_name_at_exit" TEXT NOT NULL,
    "job_title_at_exit" TEXT,
    "grade_at_exit" TEXT,
    "position_classification_name" TEXT,
    "entity_id_at_exit" TEXT NOT NULL,
    "directorate_id_at_exit" TEXT,
    "department_id_at_exit" TEXT,
    "team_id_at_exit" TEXT,
    "line_manager_employee_id" TEXT,
    "rekeyed_at" TIMESTAMP(3),
    "rekey_reason" TEXT,
    "login_revoked_at" TIMESTAMP(3),
    "departure_applied_at" TIMESTAMP(3),
    "departure_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_case_details_pkey" PRIMARY KEY ("case_id")
);

CREATE TABLE "jml_approvals" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "approval_type" "JmlApprovalType" NOT NULL,
    "holder_role_key" TEXT NOT NULL,
    "status" "JmlApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision_date" DATE,
    "reference" TEXT,
    "comments" TEXT,
    "holder_employee_id" TEXT,
    "decided_by_id" TEXT,
    "delegate_used" BOOLEAN NOT NULL DEFAULT false,
    "second_level_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_approval_authorities" (
    "id" TEXT NOT NULL,
    "approval_type" "JmlApprovalType" NOT NULL,
    "holder_label" TEXT NOT NULL,
    "delegate_employee_id" TEXT,
    "second_level_delegate_employee_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_approval_authorities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_asset_types" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_asset_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_assets" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "issued_on_case_id" TEXT,
    "returned_on_case_id" TEXT,
    "asset_type_id" TEXT NOT NULL,
    "description" TEXT,
    "identifier" TEXT,
    "issued_date" DATE,
    "condition_at_issue" TEXT,
    "return_due_date" DATE,
    "returned_date" DATE,
    "condition_at_return" TEXT,
    "deduction_applicable" BOOLEAN NOT NULL DEFAULT false,
    "deduction_amount_enc" TEXT,
    "written_off" BOOLEAN NOT NULL DEFAULT false,
    "written_off_reason" TEXT,
    "verified_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_access_checklist_items" (
    "id" TEXT NOT NULL,
    "domain" "JmlAccessDomain" NOT NULL,
    "label" TEXT NOT NULL,
    "rotation_required" BOOLEAN NOT NULL DEFAULT false,
    "shared_credential" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_access_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_access_items" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "direction" "JmlAccessDirection" NOT NULL,
    "domain" "JmlAccessDomain" NOT NULL,
    "system_name" TEXT NOT NULL,
    "access_level" TEXT,
    "shared_credential" BOOLEAN NOT NULL DEFAULT false,
    "rotation_required" BOOLEAN NOT NULL DEFAULT false,
    "due_date" DATE NOT NULL,
    "confirmed_date" DATE,
    "confirming_party" TEXT,
    "reference" TEXT,
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_access_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_gate_records" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "gate_id" TEXT NOT NULL,
    "satisfied" BOOLEAN NOT NULL DEFAULT false,
    "satisfied_at" TIMESTAMP(3),
    "satisfied_by_id" TEXT,
    "reference" TEXT,
    "overridden_by_id" TEXT,
    "override_reason" TEXT,
    "overridden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_gate_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leave_compliance_incidents" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "gate_id" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "deadline_at" DATE NOT NULL,
    "days_late" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_compliance_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_case_details_last_day_of_service_idx" ON "leave_case_details"("last_day_of_service");

CREATE INDEX "leave_case_details_exit_type_idx" ON "leave_case_details"("exit_type");

CREATE INDEX "jml_approvals_status_requested_at_idx" ON "jml_approvals"("status", "requested_at");

CREATE UNIQUE INDEX "jml_approvals_case_id_approval_type_holder_role_key_key" ON "jml_approvals"("case_id", "approval_type", "holder_role_key");

CREATE UNIQUE INDEX "jml_approval_authorities_approval_type_key" ON "jml_approval_authorities"("approval_type");

CREATE UNIQUE INDEX "jml_asset_types_label_key" ON "jml_asset_types"("label");

CREATE INDEX "jml_assets_employee_id_returned_date_idx" ON "jml_assets"("employee_id", "returned_date");

CREATE INDEX "jml_assets_returned_on_case_id_idx" ON "jml_assets"("returned_on_case_id");

CREATE UNIQUE INDEX "jml_access_checklist_items_domain_label_key" ON "jml_access_checklist_items"("domain", "label");

CREATE INDEX "jml_access_items_case_id_domain_idx" ON "jml_access_items"("case_id", "domain");

CREATE INDEX "jml_access_items_due_date_confirmed_date_idx" ON "jml_access_items"("due_date", "confirmed_date");

CREATE INDEX "leave_gate_records_overridden_by_id_overridden_at_idx" ON "leave_gate_records"("overridden_by_id", "overridden_at");

CREATE UNIQUE INDEX "leave_gate_records_case_id_gate_id_key" ON "leave_gate_records"("case_id", "gate_id");

CREATE INDEX "leave_compliance_incidents_kind_resolved_at_idx" ON "leave_compliance_incidents"("kind", "resolved_at");

CREATE UNIQUE INDEX "leave_compliance_incidents_case_id_kind_deadline_at_key" ON "leave_compliance_incidents"("case_id", "kind", "deadline_at");

ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_line_manager_employee_id_fkey" FOREIGN KEY ("line_manager_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_approvals" ADD CONSTRAINT "jml_approvals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_approvals" ADD CONSTRAINT "jml_approvals_holder_employee_id_fkey" FOREIGN KEY ("holder_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_approvals" ADD CONSTRAINT "jml_approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_approval_authorities" ADD CONSTRAINT "jml_approval_authorities_delegate_employee_id_fkey" FOREIGN KEY ("delegate_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_approval_authorities" ADD CONSTRAINT "jml_approval_authorities_second_level_delegate_employee_id_fkey" FOREIGN KEY ("second_level_delegate_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_assets" ADD CONSTRAINT "jml_assets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_assets" ADD CONSTRAINT "jml_assets_issued_on_case_id_fkey" FOREIGN KEY ("issued_on_case_id") REFERENCES "jml_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_assets" ADD CONSTRAINT "jml_assets_returned_on_case_id_fkey" FOREIGN KEY ("returned_on_case_id") REFERENCES "jml_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_assets" ADD CONSTRAINT "jml_assets_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "jml_asset_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_assets" ADD CONSTRAINT "jml_assets_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_access_items" ADD CONSTRAINT "jml_access_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_access_items" ADD CONSTRAINT "jml_access_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_access_items" ADD CONSTRAINT "jml_access_items_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_gate_records" ADD CONSTRAINT "leave_gate_records_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_gate_records" ADD CONSTRAINT "leave_gate_records_satisfied_by_id_fkey" FOREIGN KEY ("satisfied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_gate_records" ADD CONSTRAINT "leave_gate_records_overridden_by_id_fkey" FOREIGN KEY ("overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_compliance_incidents" ADD CONSTRAINT "leave_compliance_incidents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The three-date model (§6.2), the notice length and the gate ids, held by the database too.
ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_notice_days_range"
  CHECK ("notice_period_days" >= 0 AND "notice_period_days" <= 365);
ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_lpwd_after_notice"
  CHECK ("last_physical_working_day" IS NULL OR "last_physical_working_day" >= "notice_start_date");
ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_lds_after_lpwd"
  CHECK ("last_day_of_service" IS NULL OR "last_physical_working_day" IS NULL OR "last_day_of_service" >= "last_physical_working_day");
ALTER TABLE "leave_case_details" ADD CONSTRAINT "leave_case_details_departure_expat_only"
  CHECK ("departure_date" IS NULL OR "nationality" = 'EXPATRIATE');
ALTER TABLE "leave_gate_records" ADD CONSTRAINT "leave_gate_records_gate_id_known"
  CHECK ("gate_id" IN ('C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','C11'));
