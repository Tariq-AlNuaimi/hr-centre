-- Three changes, all additive. Nothing is dropped here.
--
--   1. ADR-067 step 1 — a ciphertext column for `basic_salary`, ALONGSIDE the
--      plaintext one. The plaintext is dropped in a LATER migration, only after
--      the encrypt-and-verify pass has run against the deployed database.
--   2. `sign_offs.kpi_set_hash` — what was actually signed.
--   3. `compliance_events.measured_against_deadline` — part of the event's
--      identity, so HR extending a deadline reopens the §5.5 ladder instead of
--      silencing it.
--
-- Written by hand rather than generated. `prisma migrate diff` cannot produce
-- the backfill in step 3, and this repo already hand-writes its constraint work
-- (see the Phase 2 migration's note about the three DROPs it removes).

-- 1 ---------------------------------------------------------------------------
-- Deliberately NOT `basic_salary TYPE TEXT`. The column is new and separately
-- named so that any code path still reading the old one is a TYPE ERROR rather
-- than something that compiles and hands a ciphertext to a number formatter.
ALTER TABLE "employees" ADD COLUMN "basic_salary_enc" TEXT;

-- 2 ---------------------------------------------------------------------------
-- Nullable: a row signed before this migration cannot have its historical KPI
-- set reconstructed, and inventing a hash for it would assert agreement to
-- content nobody verified. NULL means "not recorded", and the UI says so.
ALTER TABLE "sign_offs" ADD COLUMN "kpi_set_hash" TEXT;

-- 3 ---------------------------------------------------------------------------
-- Added nullable, backfilled, then made NOT NULL — the standard three-step, so
-- the migration works on a table that already holds rows.
ALTER TABLE "compliance_events" ADD COLUMN "measured_against_deadline" TIMESTAMP(3);

-- The historically correct value: the deadline of the stage the event belongs
-- to. A cycle has at most one stage per kind (`cycle_stages_cycle_id_kind_key`),
-- so this join cannot fan out.
UPDATE "compliance_events" ce
SET "measured_against_deadline" = cs."deadline"
FROM "cycle_stages" cs
WHERE cs."cycle_id" = ce."cycle_id"
  AND cs."kind" = ce."stage_kind"
  AND ce."measured_against_deadline" IS NULL;

-- Fallback for an event whose stage no longer exists. `occurred_at` is not the
-- deadline, but it is monotonic and unique enough to keep old rows from
-- colliding with each other, which is all the constraint needs of them.
UPDATE "compliance_events"
SET "measured_against_deadline" = "occurred_at"
WHERE "measured_against_deadline" IS NULL;

ALTER TABLE "compliance_events" ALTER COLUMN "measured_against_deadline" SET NOT NULL;

-- The identity change itself. Before: unique for the life of the STAGE, so the
-- sweep after an HR deadline extension re-derived the same three events, hit
-- this index, and discarded them as duplicates — freezing `missed_by_hours` at
-- the value computed against the original deadline and notifying nobody.
-- After: a re-run against the SAME deadline still collides (idempotency intact),
-- but a NEW deadline opens a fresh window for the ladder.
DROP INDEX "compliance_events_cycle_id_stage_kind_subject_employee_id_k_key";

CREATE UNIQUE INDEX "compliance_events_cycle_id_stage_kind_subject_employee_id_k_key"
  ON "compliance_events" (
    "cycle_id",
    "stage_kind",
    "subject_employee_id",
    "kind",
    "measured_against_deadline"
  );
