-- JML S6b — Word document templates and generation metadata (ADR-083).
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TYPE "JmlDocumentType" AS ENUM ('ACCEPTANCE_OF_RESIGNATION', 'TERMINATION_NOTIFICATION', 'NON_RENEWAL_NOTIFICATION', 'BANK_TERMINATION_NOTICE', 'REPATRIATION_TICKET_REQUEST', 'IT_ACCESS_REVOCATION_INSTRUCTION', 'FINAL_SETTLEMENT_WORKSHEET', 'SETTLEMENT_TRANSMITTAL_TO_FINANCE', 'CERTIFICATE_OF_SERVICE');

CREATE TYPE "JmlDocumentState" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "jml_document_templates" (
    "id" TEXT NOT NULL,
    "document_type" "JmlDocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "JmlDocumentState" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_document_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jml_generated_documents" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "document_type" "JmlDocumentType" NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "current_version_reason" TEXT,
    "generated_by_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jml_generated_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "jml_document_templates_document_type_state_idx" ON "jml_document_templates"("document_type", "state");

CREATE UNIQUE INDEX "jml_document_templates_document_type_version_key" ON "jml_document_templates"("document_type", "version");

CREATE INDEX "jml_generated_documents_case_id_generated_at_idx" ON "jml_generated_documents"("case_id", "generated_at");

CREATE INDEX "jml_generated_documents_template_id_idx" ON "jml_generated_documents"("template_id");

ALTER TABLE "jml_document_templates" ADD CONSTRAINT "jml_document_templates_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_document_templates" ADD CONSTRAINT "jml_document_templates_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jml_generated_documents" ADD CONSTRAINT "jml_generated_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jml_generated_documents" ADD CONSTRAINT "jml_generated_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "jml_document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jml_generated_documents" ADD CONSTRAINT "jml_generated_documents_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One ACTIVE template per document type (activation retires the previous one).
CREATE UNIQUE INDEX "jml_document_templates_one_active_per_type"
  ON "jml_document_templates" ("document_type") WHERE "state" = 'ACTIVE';
