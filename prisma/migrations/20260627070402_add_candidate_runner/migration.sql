-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'OPENED', 'STARTED', 'COMPLETED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('CONSENTED', 'IN_PROGRESS', 'SUBMITTED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleProfileId" TEXT NOT NULL,
    "candidateEmail" TEXT NOT NULL,
    "candidateName" TEXT,
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "sentById" TEXT,
    "batchId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'CONSENTED',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "consentAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_responses" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sjt_responses" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "sjtItemId" TEXT NOT NULL,
    "chosenOptionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sjt_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_orgId_status_idx" ON "invitations"("orgId", "status");

-- CreateIndex
CREATE INDEX "invitations_deletedAt_createdAt_idx" ON "invitations"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_invitationId_key" ON "assessments"("invitationId");

-- CreateIndex
CREATE INDEX "assessments_orgId_idx" ON "assessments"("orgId");

-- CreateIndex
CREATE INDEX "assessments_deletedAt_createdAt_idx" ON "assessments"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "item_responses_assessmentId_idx" ON "item_responses"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "item_responses_assessmentId_itemNumber_key" ON "item_responses"("assessmentId", "itemNumber");

-- CreateIndex
CREATE INDEX "sjt_responses_assessmentId_idx" ON "sjt_responses"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "sjt_responses_assessmentId_sjtItemId_key" ON "sjt_responses"("assessmentId", "sjtItemId");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_responses" ADD CONSTRAINT "item_responses_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sjt_responses" ADD CONSTRAINT "sjt_responses_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sjt_responses" ADD CONSTRAINT "sjt_responses_sjtItemId_fkey" FOREIGN KEY ("sjtItemId") REFERENCES "sjt_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
