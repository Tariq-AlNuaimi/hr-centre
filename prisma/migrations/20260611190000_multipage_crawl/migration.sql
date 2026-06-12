-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "maxPages" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "auditedUrls" TEXT[],
ADD COLUMN     "pagesAudited" INTEGER;

