-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "kind" VARCHAR(40) NOT NULL DEFAULT 'people';

-- AlterTable
ALTER TABLE "import_row_issues" ADD COLUMN     "reference" TEXT;

-- CreateIndex
CREATE INDEX "import_batches_kind_createdAt_idx" ON "import_batches"("kind", "createdAt");
