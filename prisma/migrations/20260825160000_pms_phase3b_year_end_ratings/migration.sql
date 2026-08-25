-- Phase 3b — §7.1 year-end assessment: self-rating, manager review, both sign.
--
-- Hand-written, same convention as the Phase 1/2/3a migrations in this
-- directory: the CHECK constraints below express clauses the Prisma schema has
-- no way to say.

-- 1. §7.1 — one rating per party per KPI ------------------------------------
CREATE TABLE "kpi_ratings" (
    "id" TEXT NOT NULL,
    "kpi_id" TEXT NOT NULL,
    "party" "SignOffParty" NOT NULL,
    "level" INTEGER NOT NULL,
    "comment" TEXT,
    "rated_by_employee_id" TEXT NOT NULL,
    "rated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kpi_ratings_pkey" PRIMARY KEY ("id")
);

-- §8.1 — "all components resolve onto 1–5". A level outside that is not a
-- rating; Phase 5 will map this number onto a band and a 0 or a 6 would map
-- onto nothing. In the database, not only the form: every other writer (a
-- future import, a hand-run fix) has to obey it too.
ALTER TABLE "kpi_ratings" ADD CONSTRAINT "kpi_ratings_level_range_check"
  CHECK ("level" >= 1 AND "level" <= 5);

-- A comment that is present but blank is not a comment. §7.1's divergence rule
-- (a manager who rates differently from the employee must say why) is a
-- CROSS-ROW rule and cannot be a CHECK — it lives in lib/pms/rating.ts and at
-- the boundary. What the database CAN refuse is "  " passing for an explanation.
ALTER TABLE "kpi_ratings" ADD CONSTRAINT "kpi_ratings_comment_not_blank_check"
  CHECK ("comment" IS NULL OR btrim("comment") <> '');

-- §7.1 — one self-assessment and one manager review per KPI. Re-rating before
-- the deadline updates the row; it does not append, or "the employee's rating"
-- would be ambiguous at sign-off.
CREATE UNIQUE INDEX "kpi_ratings_kpi_id_party_key" ON "kpi_ratings" ("kpi_id", "party");
CREATE INDEX "kpi_ratings_rated_by_employee_id_idx" ON "kpi_ratings" ("rated_by_employee_id");

ALTER TABLE "kpi_ratings" ADD CONSTRAINT "kpi_ratings_kpi_id_fkey"
  FOREIGN KEY ("kpi_id") REFERENCES "kpis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kpi_ratings" ADD CONSTRAINT "kpi_ratings_rated_by_employee_id_fkey"
  FOREIGN KEY ("rated_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
