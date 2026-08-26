-- How many raters a stored §9.5 figure was averaged over (red-team F8).
--
-- §9.5 says "average the 3 ratios". `overallRatio` averages over however many
-- arrived, which is deliberate and right: dividing by a hard 3 would dock a
-- ratee for a rater's departure. What was missing is the DENOMINATOR. Nothing
-- downstream recorded it, so a score built from one rater was indistinguishable
-- from one built from three — on the employee's scorecard, in §13.5's master
-- export, and in the §11 bonus that follows from the band. In the 36-person demo
-- fixture, 26 of 33 ratees had fewer than three raters available.
--
-- This column changes NO arithmetic. It is not an input to `raw_score`, it gates
-- nothing, and §13.2's publish does not consult it. Whether a thin 360 should
-- change a band is a §10 calibration judgement made by a person, and this column
-- exists to put that person in a position to make it.
--
-- NULLABLE and NOT backfilled, and the distinction is load-bearing:
--
--   NULL = the count is unknown. Every row written before this migration is in
--          that state, and the assignment data it would have to be recomputed
--          from can legitimately have moved since the run (§10.1 keeps raw
--          scores forever; it does not freeze the 360 they were built from).
--      0 = nobody rated them.
--
-- Backfilling NULL to 0 would turn "we did not record this" into "this person
-- had no raters", which is a different and false claim about a real score.
ALTER TABLE "employee_scores" ADD COLUMN "three_sixty_rater_count" INTEGER;

-- A count is never negative, and §9.4 sources three raters per ratee (report,
-- peer, colleague). The upper bound is left generous rather than pinned at 3:
-- §9.6 lets HR edit assignments, so a ratee legitimately reaching four is a
-- decision HR made, not a corruption this constraint should refuse.
ALTER TABLE "employee_scores" ADD CONSTRAINT "employee_scores_rater_count_sane_check"
  CHECK ("three_sixty_rater_count" IS NULL OR "three_sixty_rater_count" >= 0);

-- A count without a score is a contradiction: the count IS the denominator of
-- that score. A C-Level row (§8.3, no 360 at all) carries null in both.
ALTER TABLE "employee_scores" ADD CONSTRAINT "employee_scores_rater_count_needs_score_check"
  CHECK ("three_sixty_rater_count" IS NULL OR "three_sixty_score" IS NOT NULL);
