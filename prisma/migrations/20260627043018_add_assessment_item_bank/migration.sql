-- CreateEnum
CREATE TYPE "Big5Domain" AS ENUM ('OPENNESS', 'CONSCIENTIOUSNESS', 'EXTRAVERSION', 'AGREEABLENESS', 'NEUROTICISM');

-- CreateEnum
CREATE TYPE "ItemKey" AS ENUM ('PLUS', 'MINUS');

-- CreateTable
CREATE TABLE "assessment_item_bank" (
    "id" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "itemCode" TEXT NOT NULL,
    "domain" "Big5Domain" NOT NULL,
    "facet" TEXT NOT NULL,
    "facetNumber" INTEGER NOT NULL,
    "keyed" "ItemKey" NOT NULL,
    "text_en" TEXT NOT NULL,
    "text_ar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_item_bank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_item_bank_itemNumber_key" ON "assessment_item_bank"("itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_item_bank_itemCode_key" ON "assessment_item_bank"("itemCode");

-- CreateIndex
CREATE INDEX "assessment_item_bank_domain_facetNumber_idx" ON "assessment_item_bank"("domain", "facetNumber");
