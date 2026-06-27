-- CreateEnum
CREATE TYPE "RoleProfileStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BandDirection" AS ENUM ('HIGH', 'MODERATE', 'LOW');

-- CreateTable
CREATE TABLE "role_profiles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleFamilyId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RoleProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "jdSourceText" TEXT,
    "isAiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "onetRef" TEXT,
    "importance" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "direction" "BandDirection" NOT NULL DEFAULT 'HIGH',
    "targetPercentile" INTEGER NOT NULL DEFAULT 50,
    "sourceCitation" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_facets" (
    "id" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "facet" TEXT NOT NULL,

    CONSTRAINT "competency_facets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sjt_items" (
    "id" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "scenario_en" TEXT NOT NULL,
    "scenario_ar" TEXT,
    "options" JSONB NOT NULL,
    "scoringKey" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sjt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_profiles_orgId_roleFamilyId_idx" ON "role_profiles"("orgId", "roleFamilyId");

-- CreateIndex
CREATE INDEX "role_profiles_orgId_status_idx" ON "role_profiles"("orgId", "status");

-- CreateIndex
CREATE INDEX "role_profiles_deletedAt_createdAt_idx" ON "role_profiles"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "role_profiles_orgId_lineageId_version_key" ON "role_profiles"("orgId", "lineageId", "version");

-- CreateIndex
CREATE INDEX "competencies_roleProfileId_idx" ON "competencies"("roleProfileId");

-- CreateIndex
CREATE INDEX "competency_facets_competencyId_idx" ON "competency_facets"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "competency_facets_competencyId_facet_key" ON "competency_facets"("competencyId", "facet");

-- CreateIndex
CREATE INDEX "sjt_items_roleProfileId_idx" ON "sjt_items"("roleProfileId");

-- AddForeignKey
ALTER TABLE "role_profiles" ADD CONSTRAINT "role_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_profiles" ADD CONSTRAINT "role_profiles_roleFamilyId_fkey" FOREIGN KEY ("roleFamilyId") REFERENCES "role_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_facets" ADD CONSTRAINT "competency_facets_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sjt_items" ADD CONSTRAINT "sjt_items_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
