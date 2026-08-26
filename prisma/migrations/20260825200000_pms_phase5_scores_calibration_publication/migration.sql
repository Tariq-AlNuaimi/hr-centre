-- Phase 5 — §8's stored scores, §10's calibration layer, §13.2's publish gate.

CREATE TYPE "Band" AS ENUM ('OUTSTANDING', 'EXCELLENT', 'TARGET', 'ALMOST_ACHIEVED', 'UNSATISFACTORY');

CREATE TABLE "score_runs" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "started_by_employee_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "scored_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "score_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "score_runs_cycle_id_started_at_idx" ON "score_runs" ("cycle_id", "started_at");

CREATE TABLE "employee_scores" (
    "id" TEXT NOT NULL,
    "score_run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "corporate_score" DECIMAL(3,2) NOT NULL,
    "departmental_score" DECIMAL(3,2),
    "individual_score" DECIMAL(3,2) NOT NULL,
    "three_sixty_score" DECIMAL(3,2),
    "raw_score" DECIMAL(3,2) NOT NULL,
    "raw_band" "Band" NOT NULL,
    "calibrated_band" "Band" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_scores_pkey" PRIMARY KEY ("id")
);

-- §8.1 — every component, and the result, sit on the 1–5 scale. A figure
-- outside it would map onto no band and no bonus coefficient.
ALTER TABLE "employee_scores" ADD CONSTRAINT "employee_scores_ranges_check"
  CHECK (
    "corporate_score" >= 1 AND "corporate_score" <= 5
    AND ("departmental_score" IS NULL OR ("departmental_score" >= 1 AND "departmental_score" <= 5))
    AND "individual_score" >= 1 AND "individual_score" <= 5
    AND ("three_sixty_score" IS NULL OR ("three_sixty_score" >= 0 AND "three_sixty_score" <= 5))
    AND "raw_score" >= 1 AND "raw_score" <= 5
  );

CREATE UNIQUE INDEX "employee_scores_score_run_id_employee_id_key"
  ON "employee_scores" ("score_run_id", "employee_id");
CREATE INDEX "employee_scores_employee_id_idx" ON "employee_scores" ("employee_id");

CREATE TABLE "calibration_targets" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "outstanding_pct" DECIMAL(5,2) NOT NULL,
    "excellent_pct" DECIMAL(5,2) NOT NULL,
    "target_pct" DECIMAL(5,2) NOT NULL,
    "almost_achieved_pct" DECIMAL(5,2) NOT NULL,
    "unsatisfactory_pct" DECIMAL(5,2) NOT NULL,
    "min_department_size" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calibration_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calibration_targets_cycle_id_key" ON "calibration_targets" ("cycle_id");

-- §10.2 — a distribution across the five bands. It has to add up, or the gap
-- the screen shows HR against actual is measured from a target that means
-- nothing.
ALTER TABLE "calibration_targets" ADD CONSTRAINT "calibration_targets_total_check"
  CHECK (
    "outstanding_pct" + "excellent_pct" + "target_pct"
      + "almost_achieved_pct" + "unsatisfactory_pct" = 100
  );
ALTER TABLE "calibration_targets" ADD CONSTRAINT "calibration_targets_nonneg_check"
  CHECK (
    "outstanding_pct" >= 0 AND "excellent_pct" >= 0 AND "target_pct" >= 0
    AND "almost_achieved_pct" >= 0 AND "unsatisfactory_pct" >= 0
  );
-- §10.3 — the threshold is editable, but a department of fewer than two cannot
-- have a distribution shaped at all.
ALTER TABLE "calibration_targets" ADD CONSTRAINT "calibration_targets_min_size_check"
  CHECK ("min_department_size" >= 2);

CREATE TABLE "calibration_adjustments" (
    "id" TEXT NOT NULL,
    "employee_score_id" TEXT NOT NULL,
    "from_band" "Band" NOT NULL,
    "to_band" "Band" NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by_employee_id" TEXT NOT NULL,
    "adjusted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calibration_adjustments_pkey" PRIMARY KEY ("id")
);

-- §10.5 — "a mandatory reason". In the database, not only the form: an override
-- with no stated reason is the thing an employee disputes and nobody can answer.
ALTER TABLE "calibration_adjustments" ADD CONSTRAINT "calibration_adjustments_reason_not_blank_check"
  CHECK (btrim("reason") <> '');

-- An adjustment that moves nothing is not an adjustment.
ALTER TABLE "calibration_adjustments" ADD CONSTRAINT "calibration_adjustments_moves_check"
  CHECK ("from_band" <> "to_band");

CREATE INDEX "calibration_adjustments_score_adjusted_at_idx"
  ON "calibration_adjustments" ("employee_score_id", "adjusted_at");

CREATE TABLE "cycle_publications" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "published_by_employee_id" TEXT,
    "last_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cycle_publications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cycle_publications_cycle_id_key" ON "cycle_publications" ("cycle_id");

-- §13.2 — a published cycle records who published it and when. Half a
-- publication is not a state this table should hold.
ALTER TABLE "cycle_publications" ADD CONSTRAINT "cycle_publications_complete_check"
  CHECK (
    ("published" = false)
    OR ("published_at" IS NOT NULL AND "published_by_employee_id" IS NOT NULL)
  );

-- Foreign keys
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_started_by_fkey"
  FOREIGN KEY ("started_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_scores" ADD CONSTRAINT "employee_scores_score_run_id_fkey"
  FOREIGN KEY ("score_run_id") REFERENCES "score_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_scores" ADD CONSTRAINT "employee_scores_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calibration_targets" ADD CONSTRAINT "calibration_targets_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calibration_adjustments" ADD CONSTRAINT "calibration_adjustments_score_fkey"
  FOREIGN KEY ("employee_score_id") REFERENCES "employee_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calibration_adjustments" ADD CONSTRAINT "calibration_adjustments_by_fkey"
  FOREIGN KEY ("adjusted_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_publications" ADD CONSTRAINT "cycle_publications_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cycle_publications" ADD CONSTRAINT "cycle_publications_by_fkey"
  FOREIGN KEY ("published_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
