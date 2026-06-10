-- CreateEnum
CREATE TYPE "TestDimension" AS ENUM ('DESIGN', 'FUNCTIONALITY', 'BRD_COVERAGE', 'SECURITY', 'BENCHMARK');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PASS', 'WARN', 'FAIL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('MET', 'PARTIAL', 'MISSING');

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "brdText" TEXT NOT NULL,
    "dimensions" "TestDimension"[],
    "ownerId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "overallScore" DOUBLE PRECISION,
    "summary" TEXT,
    "error" TEXT,
    "finalUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "dimension" "TestDimension" NOT NULL,
    "score" DOUBLE PRECISION,
    "status" "ResultStatus" NOT NULL DEFAULT 'WARN',
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dimension_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "dimensionResultId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recommendation" TEXT,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_coverage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "status" "CoverageStatus" NOT NULL DEFAULT 'MISSING',
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirement_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessments_deletedAt_createdAt_idx" ON "assessments"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "test_runs_assessmentId_createdAt_idx" ON "test_runs"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "dimension_results_runId_idx" ON "dimension_results"("runId");

-- CreateIndex
CREATE INDEX "findings_dimensionResultId_idx" ON "findings"("dimensionResultId");

-- CreateIndex
CREATE INDEX "requirement_coverage_runId_idx" ON "requirement_coverage"("runId");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_results" ADD CONSTRAINT "dimension_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_dimensionResultId_fkey" FOREIGN KEY ("dimensionResultId") REFERENCES "dimension_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_coverage" ADD CONSTRAINT "requirement_coverage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

