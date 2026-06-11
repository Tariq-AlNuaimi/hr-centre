-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('NONE', 'FORM', 'COOKIE');

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "authMode" "AuthMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "loginUrl" TEXT;

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "role" TEXT;

-- CreateTable
CREATE TABLE "assessment_credentials" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "username" TEXT,
    "passwordEnc" TEXT,
    "cookieEnc" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_credentials_assessmentId_idx" ON "assessment_credentials"("assessmentId");

-- AddForeignKey
ALTER TABLE "assessment_credentials" ADD CONSTRAINT "assessment_credentials_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

