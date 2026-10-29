-- CreateEnum
CREATE TYPE "OrgUnitKind" AS ENUM ('DIRECTORATE', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "OrgChangeStatus" AS ENUM ('SCHEDULED', 'APPLIED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "org_unit_changes" (
    "id" TEXT NOT NULL,
    "unit_kind" "OrgUnitKind" NOT NULL,
    "unit_id" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "new_name" TEXT,
    "move_parent" BOOLEAN NOT NULL DEFAULT false,
    "new_parent_id" TEXT,
    "note" TEXT,
    "status" "OrgChangeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "before_name" TEXT,
    "before_parent_id" TEXT,
    "applied_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_unit_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_unit_changes_status_effective_date_idx" ON "org_unit_changes"("status", "effective_date");

-- CreateIndex
CREATE INDEX "org_unit_changes_unit_kind_unit_id_idx" ON "org_unit_changes"("unit_kind", "unit_id");
