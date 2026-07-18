-- NOTE: `prisma migrate dev` proposed a `DROP TABLE "document_embedding"` here and it was
-- removed by hand — `document_embedding` is the pgvector RAG store (migration
-- 20260711120000_pgvector_rag), intentionally not a Prisma model, so every diff re-proposes
-- the DROP. Always strip it; dropping it would destroy the RAG substrate (WS-5).

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN');

-- CreateTable
CREATE TABLE "custom_field_defs" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_defs_key_key" ON "custom_field_defs"("key");

-- CreateIndex
CREATE INDEX "custom_field_defs_deletedAt_createdAt_idx" ON "custom_field_defs"("deletedAt", "createdAt");
