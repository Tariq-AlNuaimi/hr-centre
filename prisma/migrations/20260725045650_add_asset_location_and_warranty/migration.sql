-- Asset location (T4) + warranty coverage (T6). Additive + forward-compatible: all three
-- columns are nullable, so a running version that doesn't read them is unaffected.
-- NOTE: `prisma migrate dev` also proposed `DROP TABLE "document_embedding"` — that table is
-- the pgvector RAG store created by the raw-SQL migration 20260711120000_pgvector_rag and is
-- intentionally NOT a Prisma model, so migrate dev mis-reads it as drift. The drop was removed
-- by hand; never let it into a migration (it would destroy the RAG substrate).
-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "location" TEXT,
ADD COLUMN     "warrantyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "warrantyTerms" TEXT;
