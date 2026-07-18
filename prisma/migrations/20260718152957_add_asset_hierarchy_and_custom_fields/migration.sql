-- NOTE: `prisma migrate dev` proposed a `DROP TABLE "document_embedding"` here and it was
-- removed by hand. `document_embedding` is the pgvector RAG store (migration
-- 20260711120000_pgvector_rag); it is INTENTIONALLY not a Prisma model (Prisma 7 has no
-- first-class `vector` type), so every `migrate dev` diff will keep re-proposing this DROP —
-- always strip it. Dropping it would destroy the RAG substrate (WS-5).

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "modelId" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "manufacturerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "asset_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "categories_deletedAt_createdAt_idx" ON "categories"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_name_key" ON "manufacturers"("name");

-- CreateIndex
CREATE INDEX "manufacturers_deletedAt_createdAt_idx" ON "manufacturers"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "asset_models_categoryId_idx" ON "asset_models"("categoryId");

-- CreateIndex
CREATE INDEX "asset_models_deletedAt_createdAt_idx" ON "asset_models"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "asset_models_manufacturerId_name_key" ON "asset_models"("manufacturerId", "name");

-- CreateIndex
CREATE INDEX "assets_modelId_idx" ON "assets"("modelId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "asset_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_models" ADD CONSTRAINT "asset_models_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
