-- CreateTable
CREATE TABLE "outcome_records" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "hired" BOOLEAN NOT NULL,
    "probationPassed" BOOLEAN,
    "rating6m" INTEGER,
    "rating12m" INTEGER,
    "retained" BOOLEAN,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outcome_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_calibrations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outcome_records_resultId_key" ON "outcome_records"("resultId");

-- CreateIndex
CREATE INDEX "outcome_records_orgId_idx" ON "outcome_records"("orgId");

-- CreateIndex
CREATE INDEX "outcome_records_deletedAt_createdAt_idx" ON "outcome_records"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "profile_calibrations_orgId_idx" ON "profile_calibrations"("orgId");

-- CreateIndex
CREATE INDEX "profile_calibrations_roleProfileId_version_idx" ON "profile_calibrations"("roleProfileId", "version");

-- AddForeignKey
ALTER TABLE "outcome_records" ADD CONSTRAINT "outcome_records_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcome_records" ADD CONSTRAINT "outcome_records_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_calibrations" ADD CONSTRAINT "profile_calibrations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_calibrations" ADD CONSTRAINT "profile_calibrations_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
