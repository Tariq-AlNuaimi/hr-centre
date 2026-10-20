-- §7.1 evidence (operator requirement, 2026-10-20).
--
-- HAND-WRITTEN, like its siblings in this directory. `prisma migrate dev` wants
-- to "fix" the schema it finds by dropping `document_embedding`, the composite
-- `employees_department_entity_agree_fkey`, `departments_id_entity_key` and
-- `kpis_assignment_period_id_idx` — none of which this feature touches, all of
-- which are hand-written SQL the schema language cannot express.
--
-- ONE migration, unlike the mid-year pair: PostgreSQL's restriction is on USING
-- a value added to an EXISTING enum in the same transaction. `CREATE TYPE`
-- followed by a table that references it is fine.
--
-- Additive: a new type and a new table. Nothing existing is read, rewritten or
-- dropped.

CREATE TYPE "EvidenceKind" AS ENUM ('FILE', 'LINK');

CREATE TABLE "kpi_evidence" (
  "id"                      TEXT NOT NULL,
  "kpi_id"                  TEXT NOT NULL,
  "kind"                    "EvidenceKind" NOT NULL,
  "label"                   TEXT NOT NULL,
  "blob_pathname"           TEXT,
  "content_type"            TEXT,
  "size_bytes"              INTEGER,
  "url"                     TEXT,
  "uploaded_by_employee_id" TEXT NOT NULL,
  "uploaded_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "manager_comment"         TEXT,
  "manager_comment_at"      TIMESTAMP(3),
  "deleted_at"              TIMESTAMP(3),
  "deleted_by"              TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kpi_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kpi_evidence_kpi_id_deleted_at_idx" ON "kpi_evidence" ("kpi_id", "deleted_at");
CREATE INDEX "kpi_evidence_uploaded_by_employee_id_idx"
  ON "kpi_evidence" ("uploaded_by_employee_id");

ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_kpi_id_fkey"
  FOREIGN KEY ("kpi_id") REFERENCES "kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_uploaded_by_employee_id_fkey"
  FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The discriminator is an invariant, not a convention. A FILE row without a
-- pathname is unreadable; a LINK row with one would mean a blob nothing points
-- at. Enforced here as well as in the route, because a route rule binds one
-- writer and a CHECK binds every writer there will ever be.
ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_kind_shape_check"
  CHECK (
    ("kind" = 'FILE'
      AND "blob_pathname" IS NOT NULL
      AND "content_type" IS NOT NULL
      AND "size_bytes" IS NOT NULL
      AND "url" IS NULL)
    OR
    ("kind" = 'LINK'
      AND "url" IS NOT NULL
      AND "blob_pathname" IS NULL
      AND "content_type" IS NULL
      AND "size_bytes" IS NULL)
  );

-- 10 MB, the operator's limit, restated where it cannot be bypassed. The route
-- refuses a larger file before a byte is uploaded; this refuses a row claiming
-- one was.
ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_size_check"
  CHECK ("size_bytes" IS NULL OR ("size_bytes" > 0 AND "size_bytes" <= 10485760));

-- A label is shown to a human; an empty one is a row nobody can identify.
ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_label_check"
  CHECK (btrim("label") <> '');

-- Who commented and when travel together, the same rule the mid-year
-- acknowledgment columns follow: half a fact is not a smaller fact, it is an
-- unreadable one.
ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_manager_comment_check"
  CHECK (
    ("manager_comment" IS NULL AND "manager_comment_at" IS NULL)
    OR ("manager_comment" IS NOT NULL AND btrim("manager_comment") <> ''
        AND "manager_comment_at" IS NOT NULL)
  );

-- Soft delete, same shape as every other recyclable row.
ALTER TABLE "kpi_evidence"
  ADD CONSTRAINT "kpi_evidence_deleted_check"
  CHECK (
    ("deleted_at" IS NULL AND "deleted_by" IS NULL)
    OR ("deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL)
  );
