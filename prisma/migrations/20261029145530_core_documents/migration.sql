-- AlterTable
ALTER TABLE "hiring_handovers" ADD COLUMN     "jml_case_id" TEXT;

-- CreateTable
CREATE TABLE "core_documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "blob_pathname" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,

    CONSTRAINT "core_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_documents_employee_id_created_at_idx" ON "core_documents"("employee_id", "created_at");

-- CreateIndex
CREATE INDEX "core_documents_deleted_at_created_at_idx" ON "core_documents"("deleted_at", "created_at");

-- AddForeignKey
ALTER TABLE "core_documents" ADD CONSTRAINT "core_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_documents" ADD CONSTRAINT "core_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ADR-098: record the joiner case each existing hand-over opened (its join
-- detail is keyed `hiring:<candidateId>`), so candidate → joiner is a stored link.
UPDATE "hiring_handovers" h SET "jml_case_id" = d."case_id"
FROM "jml_join_details" d
WHERE d."source_ref" = 'hiring:' || h."candidateId" AND h."jml_case_id" IS NULL;
