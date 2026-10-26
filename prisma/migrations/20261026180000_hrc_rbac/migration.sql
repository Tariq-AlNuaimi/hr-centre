-- HR Centre foundation F-c — role builder and scoped assignments (blueprint §3).
--
-- HAND-WRITTEN like its siblings. Additive: one enum, two tables. Nothing
-- existing is dropped — `employees."pmsRoles"` stays (read nowhere after this
-- release; dropping it is a later release, once nothing could still need it).
--
-- The starter roles are created HERE, with the same permission lists as
-- lib/rbac/catalogue.ts STARTER_ROLES (a contract test keeps the two in
-- lockstep), and existing `pmsRoles` are converted into Group-scoped
-- assignments ONCE. Doing the conversion in the migration rather than the seed
-- is the point: the seed runs on every deploy, and re-deriving assignments from
-- a stale column would resurrect an assignment an admin had removed.

CREATE TYPE "ScopeType" AS ENUM ('GROUP', 'COMPANY', 'DIRECTORATE', 'DEPARTMENT');

CREATE TABLE "access_roles" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "starter_key" TEXT,
    "deleted_at"  TIMESTAMP(3),
    "deleted_by"  TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_assignments" (
    "id"            TEXT NOT NULL,
    "user_id"       TEXT NOT NULL,
    "role_id"       TEXT NOT NULL,
    "scope_type"    "ScopeType" NOT NULL,
    "scope_id"      TEXT,
    "valid_from"    TIMESTAMP(3),
    "valid_until"   TIMESTAMP(3),
    "note"          TEXT,
    "granted_by_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_roles_starter_key_key" ON "access_roles"("starter_key");
CREATE INDEX "access_roles_deleted_at_created_at_idx" ON "access_roles"("deleted_at", "created_at");
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments"("user_id");
CREATE INDEX "role_assignments_role_id_idx" ON "role_assignments"("role_id");

ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "access_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_granted_by_id_fkey"
  FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- GROUP has no unit; every other kind names one.
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_id_check"
  CHECK (("scope_type" = 'GROUP') = ("scope_id" IS NULL));

-- A window, when given, ends after it starts. (The 180-day cap is a product
-- rule enforced in lib/rbac; this is the structural backstop.)
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_window_check"
  CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from");

-- Starter roles (lib/rbac/catalogue.ts STARTER_ROLES).
INSERT INTO "access_roles" ("id", "name", "description", "permissions", "starter_key", "updated_at") VALUES
  ('starter_hr_super_admin', 'HR Super Admin', 'Everything, including configuration, calibration and the master export.', ARRAY['people.view', 'people.edit', 'people.viewSalary', 'people.viewPersonal', 'people.viewIdDocuments', 'org.manage', 'imports.preview', 'imports.apply', 'logins.manage', 'perf.runCycle', 'perf.configure', 'perf.calibrate', 'perf.exportMaster', 'perf.viewReports']::TEXT[], 'HR_SUPER_ADMIN', CURRENT_TIMESTAMP),
  ('starter_hrbp', 'HRBP', 'Runs the performance cycle and sees people; does not configure.', ARRAY['people.view', 'people.viewSalary', 'people.viewPersonal', 'people.viewIdDocuments', 'imports.preview', 'perf.runCycle', 'perf.viewReports']::TEXT[], 'HRBP', CURRENT_TIMESTAMP),
  ('starter_executive_viewer', 'Executive Viewer', 'Read-only, organisation-wide, including salary.', ARRAY['people.view', 'people.viewSalary', 'perf.viewReports']::TEXT[], 'EXECUTIVE_VIEWER', CURRENT_TIMESTAMP);

-- One-time conversion: every employee's pmsRoles become Group assignments for
-- their login. Employees without a login record have nothing to attach to and
-- are skipped (the import provisions login records, ADR-069).
INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "scope_id", "note", "updated_at")
SELECT
  'pmsmig_' || md5(e."id" || ':' || r."pmsRole"::text),
  e."userId",
  ar."id",
  'GROUP',
  NULL,
  'Migrated from Performance roles (pmsRoles) on upgrade to HR Centre',
  CURRENT_TIMESTAMP
FROM "employees" e
CROSS JOIN LATERAL unnest(e."pmsRoles") AS r("pmsRole")
JOIN "access_roles" ar ON ar."starter_key" = r."pmsRole"::text
WHERE e."userId" IS NOT NULL
  AND e."deletedAt" IS NULL;
