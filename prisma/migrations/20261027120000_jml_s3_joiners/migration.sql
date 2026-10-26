-- JML S3 — joiner details (docs/blueprints/jml-s3-joiners.md)
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TABLE "jml_join_details" (
    "case_id" TEXT NOT NULL,
    "contract_type_id" TEXT,
    "planned_start_date" DATE,
    "actual_start_date" DATE,
    "contract_start_date" DATE,
    "contract_end_date" DATE,
    "probation_months" INTEGER,
    "payroll_applicable" BOOLEAN NOT NULL DEFAULT true,
    "client_assigned_role" BOOLEAN,
    "intro_sentence" TEXT,
    "hobbies" TEXT,
    "ms_account_required" BOOLEAN,
    "laptop_required" BOOLEAN,
    "access_card_required" BOOLEAN,
    "it_readiness_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "it_readiness_at" TIMESTAMP(3),
    "it_readiness_by_id" TEXT,
    "it_intake_submitted_at" TIMESTAMP(3),
    "it_intake_reference" TEXT,
    "it_intake_error" TEXT,
    "source_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_join_details_pkey" PRIMARY KEY ("case_id")
);

CREATE UNIQUE INDEX "jml_join_details_source_ref_key" ON "jml_join_details"("source_ref");

CREATE INDEX "jml_join_details_planned_start_date_idx" ON "jml_join_details"("planned_start_date");

ALTER TABLE "jml_join_details" ADD CONSTRAINT "jml_join_details_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_join_details" ADD CONSTRAINT "jml_join_details_contract_type_id_fkey" FOREIGN KEY ("contract_type_id") REFERENCES "jml_contract_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_join_details" ADD CONSTRAINT "jml_join_details_it_readiness_by_id_fkey" FOREIGN KEY ("it_readiness_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Onboarding §9.2: probation 0–36 months; a contract cannot end before it starts.
ALTER TABLE "jml_join_details" ADD CONSTRAINT "jml_join_details_probation_range"
  CHECK ("probation_months" IS NULL OR ("probation_months" >= 0 AND "probation_months" <= 36));
ALTER TABLE "jml_join_details" ADD CONSTRAINT "jml_join_details_contract_order"
  CHECK ("contract_start_date" IS NULL OR "contract_end_date" IS NULL OR "contract_end_date" >= "contract_start_date");
