-- §12 — the edge cases: roll-ups (§12.1/§12.2) and transfer splits (§12.3).

CREATE TYPE "RollUpReason" AS ENUM ('LEAVER_ROLLUP', 'HR_REASSIGNMENT');

-- §12.2 — the visible prompt for a temporarily rolled-up reporting line.
CREATE TABLE "manager_roll_ups" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "from_manager_employee_id" TEXT,
    "to_manager_employee_id" TEXT,
    "reason" "RollUpReason" NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_employee_id" TEXT,
    "resolution_note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manager_roll_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manager_roll_ups_resolved_at_createdAt_idx"
    ON "manager_roll_ups" ("resolved_at", "createdAt");
CREATE INDEX "manager_roll_ups_employee_id_createdAt_idx"
    ON "manager_roll_ups" ("employee_id", "createdAt");

-- §12.2 — ONE open prompt per employee. Two managers leaving above the same
-- person must not produce two competing "needs a permanent manager" cards, and
-- resolving one of them must not look like resolving both. Partial, so the
-- history of resolved roll-ups stays append-only underneath it.
CREATE UNIQUE INDEX "manager_roll_ups_one_open_per_employee"
    ON "manager_roll_ups" ("employee_id") WHERE "resolved_at" IS NULL;

-- A resolution is a decision plus its author. Half of one is a row nobody can
-- account for, which is exactly what §14's audit mandate exists to prevent.
ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_resolution_complete_check"
    CHECK (("resolved_at" IS NULL) = ("resolved_by_employee_id" IS NULL));

-- A line cannot roll up to itself.
ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_no_self_manager_check"
    CHECK ("to_manager_employee_id" IS NULL OR "to_manager_employee_id" <> "employee_id");

ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_from_manager_employee_id_fkey"
    FOREIGN KEY ("from_manager_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_to_manager_employee_id_fkey"
    FOREIGN KEY ("to_manager_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manager_roll_ups" ADD CONSTRAINT "manager_roll_ups_resolved_by_employee_id_fkey"
    FOREIGN KEY ("resolved_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- §12.3 — one slice of the cycle in one department.
CREATE TABLE "employee_assignment_periods" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "department_id" TEXT,
    "entity_id" TEXT NOT NULL,
    "manager_employee_id" TEXT,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_assignment_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_assignment_periods_employee_id_cycle_id_order_index_key"
    ON "employee_assignment_periods" ("employee_id", "cycle_id", "order_index");
CREATE INDEX "employee_assignment_periods_cycle_id_employee_id_idx"
    ON "employee_assignment_periods" ("cycle_id", "employee_id");

-- §11.4's calendar-day logic needs a period that actually has days in it. An
-- inverted range would silently contribute a negative weight to §12.3's
-- pro-rated score.
ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_range_check"
    CHECK ("ends_on" >= "starts_on");

ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_entity_id_fkey"
    FOREIGN KEY ("entity_id") REFERENCES "org_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_assignment_periods" ADD CONSTRAINT "employee_assignment_periods_manager_employee_id_fkey"
    FOREIGN KEY ("manager_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- §12.3 — which portion of a split year a KPI belongs to. NULL for the
-- overwhelming majority who never transfer, whose set covers the whole cycle.
ALTER TABLE "kpis" ADD COLUMN "assignment_period_id" TEXT;
CREATE INDEX "kpis_assignment_period_id_idx" ON "kpis" ("assignment_period_id");
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_assignment_period_id_fkey"
    FOREIGN KEY ("assignment_period_id") REFERENCES "employee_assignment_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
