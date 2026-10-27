-- JML S6 — exit interview and final settlement (Restricted figures sealed).
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TYPE "LeaveInterviewConducted" AS ENUM ('CONDUCTED', 'DECLINED');

CREATE TYPE "LeaveDestinationType" AS ENUM ('COMPETITOR', 'SAME_SECTOR', 'OTHER_SECTOR', 'PUBLIC_SECTOR', 'OVERSEAS', 'STUDY', 'NOT_DISCLOSED');

CREATE TYPE "LeaveRegrettable" AS ENUM ('REGRETTABLE', 'NON_REGRETTABLE', 'NEUTRAL');

CREATE TYPE "LeavePreventable" AS ENUM ('PREVENTABLE', 'NOT_PREVENTABLE', 'UNCLEAR');

CREATE TYPE "LeavePreventionFactor" AS ENUM ('COMPENSATION', 'CAREER_PROGRESSION', 'MANAGER_RELATIONSHIP', 'WORKLOAD_OR_BURNOUT', 'RECOGNITION', 'ROLE_CONTENT', 'LEARNING_AND_DEVELOPMENT', 'WORK_LIFE_BALANCE', 'ORGANISATIONAL_DIRECTION', 'OTHER');

CREATE TYPE "LeaveSettlementLineType" AS ENUM ('ADDITION', 'DEDUCTION');

CREATE TYPE "LeaveDeductionType" AS ENUM ('VISA_COST_RECOVERY', 'MEDICAL_INSURANCE', 'NEGATIVE_LEAVE_BALANCE', 'NOTICE_SHORTFALL', 'UNRETURNED_OR_DAMAGED_ASSET', 'OUTSTANDING_ADVANCE_OR_LOAN');

CREATE TABLE "leave_exit_interviews" (
    "case_id" TEXT NOT NULL,
    "conducted" "LeaveInterviewConducted" NOT NULL,
    "primary_l1" "LeaveReasonLevel1" NOT NULL,
    "primary_l2_code" TEXT NOT NULL,
    "secondary_l2_code" TEXT,
    "narrative_enc" TEXT,
    "destination_type" "LeaveDestinationType",
    "retention_attempted" BOOLEAN,
    "counter_offer_made" BOOLEAN,
    "recommend_score" INTEGER NOT NULL,
    "return_score" INTEGER NOT NULL,
    "interviewed_at" DATE,
    "interviewer_id" TEXT,
    "regrettable" "LeaveRegrettable",
    "preventable" "LeavePreventable",
    "prevention_factor" "LeavePreventionFactor",
    "assessor_id" TEXT,
    "assessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_exit_interviews_pkey" PRIMARY KEY ("case_id")
);

CREATE TABLE "leave_settlements" (
    "case_id" TEXT NOT NULL,
    "figures_enc" TEXT,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "unverified_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hire_date" DATE,
    "calculated_at" TIMESTAMP(3),
    "calculated_by_id" TEXT,
    "recalculation_required" BOOLEAN NOT NULL DEFAULT false,
    "signature_reference" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "payment_date" DATE,
    "payment_reference" TEXT,
    "payment_confirmed_at" TIMESTAMP(3),
    "payment_confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_settlements_pkey" PRIMARY KEY ("case_id")
);

CREATE TABLE "leave_settlement_lines" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "line_type" "LeaveSettlementLineType" NOT NULL,
    "deduction_type" "LeaveDeductionType",
    "description" TEXT NOT NULL,
    "line_amount_enc" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "documentary_reference" TEXT NOT NULL,
    "authorised_by_id" TEXT,
    "asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_settlement_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_exit_interviews_primary_l1_primary_l2_code_idx" ON "leave_exit_interviews"("primary_l1", "primary_l2_code");

CREATE INDEX "leave_exit_interviews_regrettable_preventable_idx" ON "leave_exit_interviews"("regrettable", "preventable");

CREATE INDEX "leave_settlements_provisional_approved_at_idx" ON "leave_settlements"("provisional", "approved_at");

CREATE INDEX "leave_settlement_lines_case_id_line_type_idx" ON "leave_settlement_lines"("case_id", "line_type");

ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_primary_l2_code_fkey" FOREIGN KEY ("primary_l2_code") REFERENCES "leave_reason_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_secondary_l2_code_fkey" FOREIGN KEY ("secondary_l2_code") REFERENCES "leave_reason_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_settlements" ADD CONSTRAINT "leave_settlements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_settlements" ADD CONSTRAINT "leave_settlements_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_settlements" ADD CONSTRAINT "leave_settlements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_settlements" ADD CONSTRAINT "leave_settlements_payment_confirmed_by_id_fkey" FOREIGN KEY ("payment_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_settlement_lines" ADD CONSTRAINT "leave_settlement_lines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "leave_settlements"("case_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_settlement_lines" ADD CONSTRAINT "leave_settlement_lines_authorised_by_id_fkey" FOREIGN KEY ("authorised_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_settlement_lines" ADD CONSTRAINT "leave_settlement_lines_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "jml_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- §12.4: both scores are whole numbers 1–5.
ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_scores_check"
  CHECK ("recommend_score" BETWEEN 1 AND 5 AND "return_score" BETWEEN 1 AND 5);

-- The secondary reason never repeats the primary.
ALTER TABLE "leave_exit_interviews" ADD CONSTRAINT "leave_exit_interviews_secondary_differs_check"
  CHECK ("secondary_l2_code" IS NULL OR "secondary_l2_code" <> "primary_l2_code");

-- A deduction line names its §16.1 type; an addition never does.
ALTER TABLE "leave_settlement_lines" ADD CONSTRAINT "leave_settlement_lines_type_check"
  CHECK (("line_type" = 'DEDUCTION') = ("deduction_type" IS NOT NULL));
