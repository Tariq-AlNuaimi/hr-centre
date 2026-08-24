-- PMS Phase 1 — org foundation & import layer.
-- Contract: docs/blueprints/performance-management-system.md (spec v1.0 §1, §3, §4).
-- Governance: ADR-065 (identity & roles).
--
-- Forward-compatible and additive: creates new enums/tables only. No existing
-- column is altered or dropped, so a running instance keeps working through the
-- deploy (`vercel.json` runs `prisma migrate deploy` on every build).

-- CreateEnum
CREATE TYPE "PmsRole" AS ENUM ('HR_SUPER_ADMIN', 'HRBP', 'EXECUTIVE_VIEWER');

-- CreateEnum
CREATE TYPE "RoleTrack" AS ENUM ('C_LEVEL', 'DIRECTOR', 'MANAGER', 'LEAD', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'LEAVER');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "org_entities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "odoo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "departmentId" TEXT,
    "entityId" TEXT NOT NULL,
    "managerId" TEXT,
    "roleTrack" "RoleTrack" NOT NULL,
    "pmsRoles" "PmsRole"[],
    "basic_salary" DECIMAL(14,3),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_working_day" DATE,
    "unpaid_leave_days" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "uploadedById" TEXT,
    "uploaded_by_email" TEXT,
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_created" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "rows_rejected" INTEGER NOT NULL DEFAULT 0,
    "rows_absent" INTEGER NOT NULL DEFAULT 0,
    "preview_json" JSONB,
    "applied_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_issues" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "odoo_id" TEXT,
    "field" TEXT,
    "rule" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'REJECT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_entities_code_key" ON "org_entities"("code");

-- CreateIndex
CREATE INDEX "org_entities_deletedAt_createdAt_idx" ON "org_entities"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "departments_entityId_idx" ON "departments"("entityId");

-- CreateIndex
CREATE INDEX "departments_deletedAt_createdAt_idx" ON "departments"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "departments_entityId_name_key" ON "departments"("entityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_odoo_id_key" ON "employees"("odoo_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_deletedAt_createdAt_idx" ON "employees"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "employees_managerId_idx" ON "employees"("managerId");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_entityId_idx" ON "employees"("entityId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "import_batches_status_createdAt_idx" ON "import_batches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_createdAt_idx" ON "import_batches"("createdAt");

-- CreateIndex
CREATE INDEX "import_row_issues_batchId_severity_idx" ON "import_row_issues"("batchId", "severity");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "org_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "org_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_issues" ADD CONSTRAINT "import_row_issues_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants that the Prisma datamodel cannot express, enforced in the database
-- so they hold for EVERY writer -- the import layer, a future Odoo sync, a
-- seed script, or a hand-run SQL fix -- not just for code paths that remember
-- to check. The same rules are also enforced in zod at the API boundary; these
-- are the backstop, not the primary UX.
-- ---------------------------------------------------------------------------

-- Spec §1.2: "Each employee belongs to exactly one department... C-Level
-- employees are the exception: they are tagged to an entity directly, with no
-- department." So department membership is an exclusive-or with being C-Level.
-- Without this, a C-Level with a department would silently pick up a
-- Departmental KPI component they have no formula slot for (§8.3), and a
-- department-less Individual would drop out of departmental scoring entirely.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_department_xor_c_level_check"
  CHECK (
    ("roleTrack" = 'C_LEVEL' AND "departmentId" IS NULL)
    OR
    ("roleTrack" <> 'C_LEVEL' AND "departmentId" IS NOT NULL)
  );

-- Spec §1.2: "an employee's entity is implied by their department." `entityId`
-- is denormalized onto employees (see the schema comment) so entity-scoped reads
-- do not join through departments. A denormalized column that can drift silently
-- is worse than the join it saves, so the agreement is enforced declaratively:
-- a composite foreign key on (departmentId, entityId) makes it impossible to
-- point an employee at a department belonging to a different entity.
--
-- `departments.id` is already the primary key, but a composite FK requires a
-- matching unique constraint on the exact referenced column pair.
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_id_entity_key" UNIQUE ("id", "entityId");

-- MATCH SIMPLE (the default) skips the check when any referencing column is
-- NULL -- which is exactly right here: a C-Level employee has a NULL
-- departmentId and is governed by the XOR check above instead.
--
-- RESTRICT rather than SET NULL: this pair cannot be nulled together, because
-- entityId is NOT NULL. Deleting a department is already a soft delete in this
-- application, so RESTRICT is the correct answer to a hard delete that would
-- orphan employees -- refuse it.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_department_entity_agree_fkey"
  FOREIGN KEY ("departmentId", "entityId")
  REFERENCES "departments"("id", "entityId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- An employee cannot be their own manager. The recursive descendant walk in
-- lib/pms/org-tree.ts is depth-capped and therefore survives a cycle, but a
-- self-loop is never legitimate data and is cheap to refuse at the source.
-- (Longer cycles A->B->A are rejected by the import validator, which can see
-- the whole proposed graph; a single-row CHECK cannot.)
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_manager_not_self_check"
  CHECK ("managerId" IS NULL OR "managerId" <> "id");

-- Spec §11.4/§11.5 feed these into a bonus calculation: a negative unpaid-leave
-- count would inflate the pro-rated day count, and a negative salary would
-- invert the sign of a payment. Neither is recoverable downstream, so neither
-- is allowed in.
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_unpaid_leave_days_non_negative_check"
  CHECK ("unpaid_leave_days" >= 0);

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_basic_salary_non_negative_check"
  CHECK ("basic_salary" IS NULL OR "basic_salary" >= 0);

-- Import counters are counts; a negative one means a bug in the reconciler
-- rather than a legitimate state.
ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_counts_non_negative_check"
  CHECK (
    "rows_total" >= 0 AND "rows_created" >= 0 AND "rows_updated" >= 0
    AND "rows_rejected" >= 0 AND "rows_absent" >= 0
  );

-- `severity` is a two-value vocabulary consumed by the import preview UI.
-- Constrained here rather than promoted to a Prisma enum so that adding a
-- third severity later is a data decision, not a migration on a hot enum type.
ALTER TABLE "import_row_issues"
  ADD CONSTRAINT "import_row_issues_severity_check"
  CHECK ("severity" IN ('REJECT', 'WARNING'));
