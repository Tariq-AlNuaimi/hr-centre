-- UAT Scenario C — §6.2's mid-year flow gains the employee's acknowledgment.
--
-- Columns and constraints. Separate from the enum migration beside it because
-- PostgreSQL will not let a CHECK name an enum value added in the same
-- transaction; see that file's header before merging the two back together.
--
-- HAND-WRITTEN ON PURPOSE. `prisma migrate dev` wanted to "fix" the schema it
-- found by dropping the `document_embedding` table, the composite
-- `employees_department_entity_agree_fkey`, `departments_id_entity_key` and
-- `kpis_assignment_period_id_idx` — none of which this feature touches, and all
-- of which are hand-written SQL that Prisma's schema language cannot express, so
-- every diff wants to normalise them away. Regenerate this file and you will
-- reintroduce those drops. Add columns here by hand instead.

-- §6.2 — the employee's acknowledgment: who and when, for §6.3's history.
ALTER TABLE "kpi_change_requests"
  ADD COLUMN "acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "acknowledged_by_employee_id" TEXT,
  ADD COLUMN "acknowledgment_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" TEXT;

ALTER TABLE "kpi_change_requests"
  ADD CONSTRAINT "kpi_change_requests_acknowledged_by_employee_id_fkey"
  FOREIGN KEY ("acknowledged_by_employee_id") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- An acknowledgment is who AND when, or neither. Half of one is not a state
-- this table should be able to hold — the same rule the decision columns carry.
ALTER TABLE "kpi_change_requests"
  ADD CONSTRAINT "kpi_change_requests_acknowledgment_complete_check"
  CHECK (
    ("acknowledged_at" IS NULL AND "acknowledged_by_employee_id" IS NULL)
    OR
    ("acknowledged_at" IS NOT NULL AND "acknowledged_by_employee_id" IS NOT NULL)
  );

-- §6.2 — HR may approve without the employee's acknowledgment ONLY with a
-- written reason. In the database, not only the form, for the same reason the
-- rejection reason is: a form rule is bypassable by every other writer.
-- Blank-but-present is refused too, because "  " satisfies NOT NULL and
-- satisfies nobody reading the history later.
ALTER TABLE "kpi_change_requests"
  ADD CONSTRAINT "kpi_change_requests_override_reason_check"
  CHECK (
    "acknowledgment_overridden" = false
    OR ("override_reason" IS NOT NULL AND btrim("override_reason") <> '')
  );

-- An override is BY DEFINITION the absence of an acknowledgment. Allowing both
-- would let the history claim the employee agreed AND that HR overrode them.
ALTER TABLE "kpi_change_requests"
  ADD CONSTRAINT "kpi_change_requests_override_excludes_ack_check"
  CHECK ("acknowledgment_overridden" = false OR "acknowledged_at" IS NULL);

-- NOT_ACKNOWLEDGED is terminal and has NO decider: the deadline closed it, not
-- a person. The existing constraint allowed a null decider only for PENDING and
-- WITHDRAWN, so it has to learn the third case or the sweep could never write
-- the row. Dropped and recreated rather than renamed, so the name stays the one
-- every other migration and error message already refers to.
ALTER TABLE "kpi_change_requests"
  DROP CONSTRAINT "kpi_change_requests_decision_complete_check";

ALTER TABLE "kpi_change_requests"
  ADD CONSTRAINT "kpi_change_requests_decision_complete_check"
  CHECK (
    ("status" IN ('PENDING', 'WITHDRAWN', 'NOT_ACKNOWLEDGED')
      AND "decided_by_employee_id" IS NULL AND "decided_at" IS NULL)
    OR
    ("status" IN ('APPROVED', 'REJECTED')
      AND "decided_by_employee_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  );

-- Requests already PENDING when this ships are treated as NOT acknowledged:
-- the columns default to NULL and nothing backfills them. Grandfathering them
-- as acknowledged would record a consent nobody gave, which is the one thing
-- §6.3's history must never do.
