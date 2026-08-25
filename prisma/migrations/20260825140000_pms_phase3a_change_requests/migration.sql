-- Phase 3a — §6 mid-year change requests and §6.3 version history.
--
-- Hand-written rather than generated: the generator cannot produce the
-- `sign_offs` backfill, and the CHECK constraints below express clauses the
-- Prisma schema has no way to say. Same convention as the Phase 1 and Phase 2
-- migrations in this directory.

-- 1. §6.2's request status ----------------------------------------------------
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- 2. `sign_offs` learns WHICH signature it is ---------------------------------
--
-- Its key was [participant_id, party], which says a participant signs once ever.
-- §7.1 needs a SECOND pair at year-end on the same participant — without this
-- discriminator that signature collides with the goal-setting one and comes back
-- as "already signed", §5.1's flow silently swallowing §7.1's.
--
-- DEFAULT 'GOAL_SETTING' is the backfill: every row that exists today was
-- created by the Phase 2 goal-setting flow, which is the only one that wrote
-- here. The default stays on the column so a caller that forgets the field
-- lands on the historically correct value rather than failing.
ALTER TABLE "sign_offs"
  ADD COLUMN "stage_kind" "CycleStageKind" NOT NULL DEFAULT 'GOAL_SETTING';

DROP INDEX "sign_offs_participant_id_party_key";

CREATE UNIQUE INDEX "sign_offs_participant_id_stage_kind_party_key"
  ON "sign_offs" ("participant_id", "stage_kind", "party");

-- 3. §6.2 — the request ------------------------------------------------------
CREATE TABLE "kpi_change_requests" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "requested_by_employee_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_employee_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kpi_change_requests_pkey" PRIMARY KEY ("id")
);

-- §6.2 — "HR must enter a reason (mandatory field) that the manager can see".
-- In the database, not only the form: a form rule is bypassable by every other
-- writer (a hand-run fix, a future route, the import). Blank-but-present is
-- rejected too, because "  " satisfies NOT NULL and satisfies nobody reading it.
ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_rejection_reason_check"
  CHECK ("status" <> 'REJECTED' OR ("decision_reason" IS NOT NULL AND btrim("decision_reason") <> ''));

-- A decided request records WHO decided and WHEN; a pending one records neither.
-- Half a decision is not a state this table should be able to hold.
ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_decision_complete_check"
  CHECK (
    ("status" IN ('PENDING', 'WITHDRAWN') AND "decided_by_employee_id" IS NULL AND "decided_at" IS NULL)
    OR
    ("status" IN ('APPROVED', 'REJECTED') AND "decided_by_employee_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  );

-- A rationale nobody can read is not a rationale (§6.2 — HR decides on it).
ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_rationale_not_blank_check"
  CHECK (btrim("rationale") <> '');

-- 4. §6.2 — one KPI's proposed new state -------------------------------------
--
-- Every column nullable ON PURPOSE: NULL means "unchanged", which is how a
-- PARTIAL change ("descriptors/metrics only") is expressed against a full
-- overhaul where all seven are set.
CREATE TABLE "kpi_change_request_edits" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kpi_id" TEXT NOT NULL,
    "description" TEXT,
    "weightage" DECIMAL(5,2),
    "descriptor_outstanding" TEXT,
    "descriptor_excellent" TEXT,
    "descriptor_target" TEXT,
    "descriptor_almost_achieved" TEXT,
    "descriptor_unsatisfactory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_change_request_edits_pkey" PRIMARY KEY ("id")
);

-- An edit that changes nothing is noise in §6.3's history — at least one field.
ALTER TABLE "kpi_change_request_edits" ADD CONSTRAINT "kpi_change_request_edits_not_empty_check"
  CHECK (
    "description" IS NOT NULL OR "weightage" IS NOT NULL
    OR "descriptor_outstanding" IS NOT NULL OR "descriptor_excellent" IS NOT NULL
    OR "descriptor_target" IS NOT NULL OR "descriptor_almost_achieved" IS NOT NULL
    OR "descriptor_unsatisfactory" IS NOT NULL
  );

-- §5.2's bound, restated here: an edit is a proposed KPI state and must obey the
-- same range the live column does.
ALTER TABLE "kpi_change_request_edits" ADD CONSTRAINT "kpi_change_request_edits_weightage_range_check"
  CHECK ("weightage" IS NULL OR ("weightage" >= 0 AND "weightage" <= 100));

CREATE UNIQUE INDEX "kpi_change_request_edits_request_id_kpi_id_key"
  ON "kpi_change_request_edits" ("request_id", "kpi_id");

-- 5. §6.3 — the archive ------------------------------------------------------
CREATE TABLE "kpi_versions" (
    "id" TEXT NOT NULL,
    "kpi_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "weightage" DECIMAL(5,2) NOT NULL,
    "descriptor_outstanding" TEXT NOT NULL,
    "descriptor_excellent" TEXT NOT NULL,
    "descriptor_target" TEXT NOT NULL,
    "descriptor_almost_achieved" TEXT NOT NULL,
    "descriptor_unsatisfactory" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "superseded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_request_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "kpi_versions" ADD CONSTRAINT "kpi_versions_version_no_positive_check"
  CHECK ("version_no" >= 1);

ALTER TABLE "kpi_versions" ADD CONSTRAINT "kpi_versions_weightage_range_check"
  CHECK ("weightage" >= 0 AND "weightage" <= 100);

CREATE UNIQUE INDEX "kpi_versions_kpi_id_version_no_key" ON "kpi_versions" ("kpi_id", "version_no");
CREATE INDEX "kpi_versions_kpi_id_superseded_at_idx" ON "kpi_versions" ("kpi_id", "superseded_at");

-- 6. Indexes and foreign keys -------------------------------------------------
CREATE INDEX "kpi_change_requests_participant_id_status_idx"
  ON "kpi_change_requests" ("participant_id", "status");

-- At most ONE pending request per participant.
--
-- Two concurrent pending requests are each validated against the CURRENT set,
-- so each can total 100 on its own and still leave the set off 100 once both are
-- approved — §5.3 broken by two individually-legal acts. A partial unique index
-- makes the second submission impossible rather than merely unlikely, which a
-- route-level check alone cannot do across two requests in flight.
--
-- Partial (`WHERE status = 'PENDING'`) so a participant may accumulate any
-- number of decided or withdrawn requests: §6.3 wants the whole history.
CREATE UNIQUE INDEX "kpi_change_requests_one_pending_per_participant"
  ON "kpi_change_requests" ("participant_id") WHERE "status" = 'PENDING';
CREATE INDEX "kpi_change_requests_status_requested_at_idx"
  ON "kpi_change_requests" ("status", "requested_at");
CREATE INDEX "kpi_change_request_edits_kpi_id_idx" ON "kpi_change_request_edits" ("kpi_id");

ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "cycle_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_requested_by_employee_id_fkey"
  FOREIGN KEY ("requested_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kpi_change_requests" ADD CONSTRAINT "kpi_change_requests_decided_by_employee_id_fkey"
  FOREIGN KEY ("decided_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kpi_change_request_edits" ADD CONSTRAINT "kpi_change_request_edits_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "kpi_change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kpi_change_request_edits" ADD CONSTRAINT "kpi_change_request_edits_kpi_id_fkey"
  FOREIGN KEY ("kpi_id") REFERENCES "kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kpi_versions" ADD CONSTRAINT "kpi_versions_kpi_id_fkey"
  FOREIGN KEY ("kpi_id") REFERENCES "kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
