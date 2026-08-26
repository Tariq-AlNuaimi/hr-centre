-- §3.3's "Date of Joining", which Phase 1 omitted.
--
-- §3.3 lists it among the required employee fields and names what depends on it:
-- "Anchor for 6-month eligibility gate, pro-ration Work Days, and effective
-- service (§11)". Without it, §11.2 cannot decide eligibility and §11.4 cannot
-- pro-rate — both would have had to guess.
--
-- Added NULLABLE on purpose, and NOT backfilled. Every existing row predates the
-- column, and the only values available to invent one from (`createdAt`, the
-- import batch date) are row-creation timestamps, not employment facts. Deriving
-- a bonus eligibility date from when a database row happened to be written is
-- exactly the kind of silent wrong answer this system exists to avoid.
--
-- Null therefore means "not on file". §3.4's import check requires it going
-- forward, and §11's computation refuses to score a bonus without it — which
-- surfaces the gap to HR instead of hiding it inside a number.
ALTER TABLE "employees" ADD COLUMN "date_of_joining" DATE;

-- A joining date in the future is a typo, not a hire.
ALTER TABLE "employees" ADD CONSTRAINT "employees_date_of_joining_sane_check"
  CHECK ("date_of_joining" IS NULL OR "date_of_joining" <= CURRENT_DATE + INTERVAL '1 year');

-- Nobody leaves before they join.
ALTER TABLE "employees" ADD CONSTRAINT "employees_joining_before_leaving_check"
  CHECK (
    "date_of_joining" IS NULL OR "last_working_day" IS NULL
    OR "last_working_day" >= "date_of_joining"
  );
