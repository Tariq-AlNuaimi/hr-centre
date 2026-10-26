-- JML S4 — mover details (docs/blueprints/jml-s4-movers.md)
-- Hand-trimmed from `prisma migrate diff` to this slice's objects only.

CREATE TABLE "jml_move_details" (
    "case_id" TEXT NOT NULL,
    "change_type" "JmlChangeType" NOT NULL,
    "effective_date" DATE NOT NULL,
    "previous_details" JSONB NOT NULL,
    "new_details" JSONB NOT NULL,
    "applied_at" TIMESTAMP(3),
    "apply_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_move_details_pkey" PRIMARY KEY ("case_id")
);

CREATE INDEX "jml_move_details_effective_date_idx" ON "jml_move_details"("effective_date");

ALTER TABLE "jml_move_details" ADD CONSTRAINT "jml_move_details_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
