-- PHASE 2 of the category expand/contract (OPEN-ITEMS item 7; register 2026-07-25).
--
-- Phase 1 (migration-free, 2026-07-25) removed every read and write of `Asset.category`
-- from application code — an asset's category comes from `model → AssetModel.category →
-- Category`. This drops the now-inert column and its enum type.
--
-- SAFE TO RUN because nothing reads the column any more. Ordering matters: the column
-- must go before the type, or Postgres refuses to drop a type still in use.
--
-- Hand-written deliberately: `prisma migrate dev` also proposes
-- `DROP TABLE "document_embedding"` here, because the pgvector RAG store is created by a
-- raw-SQL migration (20260711120000_pgvector_rag) and is not a Prisma model, so the
-- differ mis-reads it as drift. That drop must NEVER ship — it would destroy the RAG
-- substrate on every deploy.

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "category";

-- DropEnum
DROP TYPE "AssetCategory";
