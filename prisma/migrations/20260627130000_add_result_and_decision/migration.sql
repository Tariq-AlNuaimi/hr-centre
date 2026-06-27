-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('ADVANCE', 'HOLD', 'DECLINE');

-- CreateTable
CREATE TABLE "results" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "roleProfileVersion" INTEGER NOT NULL,
    "facetScores" JSONB NOT NULL,
    "domainScores" JSONB NOT NULL,
    "sjtScores" JSONB NOT NULL,
    "competencyScores" JSONB NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "communityPercentile" INTEGER,
    "scoringModel" TEXT NOT NULL DEFAULT 'IPIP-NEO-120',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narrative" TEXT,
    "narrativeModel" TEXT,
    "narrativeAt" TIMESTAMP(3),
    "decision" "DecisionOutcome",
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "results_assessmentId_key" ON "results"("assessmentId");

-- CreateIndex
CREATE INDEX "results_orgId_idx" ON "results"("orgId");

-- CreateIndex
CREATE INDEX "results_roleProfileId_idx" ON "results"("roleProfileId");

-- CreateIndex
CREATE INDEX "results_deletedAt_createdAt_idx" ON "results"("deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
