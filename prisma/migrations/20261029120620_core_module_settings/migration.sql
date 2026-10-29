-- CreateTable
CREATE TABLE "core_module_settings" (
    "id" TEXT NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_module_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_module_settings_updated_by_id_idx" ON "core_module_settings"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_module_settings_module_key_key" ON "core_module_settings"("module", "key");

-- AddForeignKey
ALTER TABLE "core_module_settings" ADD CONSTRAINT "core_module_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ADR-092: copy every existing module setting into the core store. Values are
-- copied verbatim (sealed AI keys stay sealed); the old tables stay until the
-- new path is verified live, then a later migration drops them.
INSERT INTO "core_module_settings" ("id", "module", "key", "value", "created_at", "updated_at")
SELECT 'hiring_' || s."id", 'hiring', s."key", s."value", s."updatedAt", s."updatedAt"
FROM "hiring_settings" s
ON CONFLICT ("module", "key") DO NOTHING;

INSERT INTO "core_module_settings" ("id", "module", "key", "value", "updated_by_id", "created_at", "updated_at")
SELECT 'tickets_' || k.key, 'tickets', k.key, k.value, t."updatedById", t."createdAt", t."updatedAt"
FROM "hive_ticket_settings" t
CROSS JOIN LATERAL (VALUES
  ('ticketPrefix', to_jsonb(t."ticketPrefix")),
  ('statusLabels', t."statusLabels"::jsonb),
  ('responseHours', to_jsonb(t."response_hours"))
) AS k(key, value)
WHERE t."id" = 'singleton'
ON CONFLICT ("module", "key") DO NOTHING;
