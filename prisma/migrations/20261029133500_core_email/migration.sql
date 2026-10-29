-- ADR-095: one email log and one template store for every module.
--
-- 1. The JML email log becomes the core log IN PLACE (a rename keeps every row,
--    every id and every resend link). Existing rows are JML's: `module` = 'jml'.
ALTER TABLE "jml_email_logs" RENAME TO "core_email_logs";
ALTER TABLE "core_email_logs" RENAME CONSTRAINT "jml_email_logs_pkey" TO "core_email_logs_pkey";
ALTER TABLE "core_email_logs" RENAME CONSTRAINT "jml_email_logs_case_id_fkey" TO "core_email_logs_case_id_fkey";
ALTER TABLE "core_email_logs" RENAME CONSTRAINT "jml_email_logs_resend_of_id_fkey" TO "core_email_logs_resend_of_id_fkey";
ALTER TABLE "core_email_logs" RENAME CONSTRAINT "jml_email_logs_sent_by_id_fkey" TO "core_email_logs_sent_by_id_fkey";
ALTER INDEX "jml_email_logs_status_scheduled_for_idx" RENAME TO "core_email_logs_status_scheduled_for_idx";
ALTER INDEX "jml_email_logs_case_id_created_at_idx" RENAME TO "core_email_logs_case_id_created_at_idx";

ALTER TABLE "core_email_logs"
  ADD COLUMN "module" VARCHAR(20) NOT NULL DEFAULT 'jml',
  ADD COLUMN "subject_type" VARCHAR(40),
  ADD COLUMN "subject_id" TEXT;
CREATE INDEX "core_email_logs_module_created_at_idx" ON "core_email_logs"("module", "created_at");
CREATE INDEX "core_email_logs_subject_type_subject_id_idx" ON "core_email_logs"("subject_type", "subject_id");

-- 2. The core template store.
CREATE TABLE "core_email_templates" (
    "id" TEXT NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "cc_recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_email_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "core_email_templates_updated_by_id_idx" ON "core_email_templates"("updated_by_id");
CREATE UNIQUE INDEX "core_email_templates_module_key_key" ON "core_email_templates"("module", "key");
ALTER TABLE "core_email_templates" ADD CONSTRAINT "core_email_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Copy both module stores in. JML overrides keep their nulls (null = the
--    approved text); the ticket template is a full text (live rows only — a
--    soft-deleted row was not in effect). The old tables stay until the new path
--    is verified live.
INSERT INTO "core_email_templates" ("id", "module", "key", "subject", "body", "cc_recipients", "updated_by_id", "created_at", "updated_at")
SELECT 'jml_' || o."id", 'jml', o."type", o."subject", o."body", o."cc_recipients", o."updated_by_id", o."created_at", o."updated_at"
FROM "jml_email_template_overrides" o
ON CONFLICT ("module", "key") DO NOTHING;

INSERT INTO "core_email_templates" ("id", "module", "key", "subject", "body", "updated_by_id", "created_at", "updated_at")
SELECT 'tickets_' || t."id", 'tickets', t."key", t."subject", t."body", t."updatedById", t."createdAt", t."updatedAt"
FROM "hive_email_templates" t
WHERE t."deletedAt" IS NULL
ON CONFLICT ("module", "key") DO NOTHING;

-- 4. Per-person notification preferences (no rows yet: everyone keeps today's defaults).
CREATE TABLE "core_notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "core_notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "core_notification_preferences_user_id_kind_key" ON "core_notification_preferences"("user_id", "kind");
ALTER TABLE "core_notification_preferences" ADD CONSTRAINT "core_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
