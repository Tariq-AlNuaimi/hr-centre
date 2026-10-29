-- P2 platform clean-up (ADR-090, 092, 094–097): the legacy module stores whose
-- data moved to core tables in earlier migrations, now that every new path is
-- deployed and verified live.
--
-- First, a last idempotent sweep: anything an old instance wrote to a legacy
-- table while the deploy that switched paths was rolling out is copied across
-- (ON CONFLICT DO NOTHING — a value already in the core store wins).

INSERT INTO "core_magic_links" ("id", "purpose", "subject_id", "token_hash", "expires_at", "revoked_at", "last_used_at", "created_at")
SELECT t."id", 'hive.reply', t."escalationId", t."tokenHash", t."expiresAt", t."revokedAt", t."lastUsedAt", t."createdAt"
FROM "hive_escalation_reply_tokens" t
ON CONFLICT DO NOTHING;

INSERT INTO "core_module_settings" ("id", "module", "key", "value", "created_at", "updated_at")
SELECT 'hiring_' || s."id", 'hiring', s."key", s."value", s."updatedAt", s."updatedAt"
FROM "hiring_settings" s
WHERE s."key" NOT LIKE 'ai.%' OR s."key" = 'ai.scoringWeights'
ON CONFLICT DO NOTHING;

INSERT INTO "core_email_templates" ("id", "module", "key", "subject", "body", "cc_recipients", "updated_by_id", "created_at", "updated_at")
SELECT 'jml_' || o."id", 'jml', o."type", o."subject", o."body", o."cc_recipients", o."updated_by_id", o."created_at", o."updated_at"
FROM "jml_email_template_overrides" o
ON CONFLICT DO NOTHING;

INSERT INTO "core_grades" ("id", "code", "name", "minSalary", "maxSalary", "order", "entityId", "deletedAt", "deletedBy", "createdAt", "updatedAt")
SELECT "id", "code", "name", "minSalary", "maxSalary", "order", "entityId", "deletedAt", "deletedBy", "createdAt", "updatedAt"
FROM "hiring_grades"
ON CONFLICT DO NOTHING;

INSERT INTO "core_competencies" ("id", "name", "definition", "category", "roleFamily", "entityId", "anchors", "deletedAt", "deletedBy", "createdAt", "updatedAt")
SELECT "id", "name", "definition", "category", "roleFamily", "entityId", "anchors", "deletedAt", "deletedBy", "createdAt", "updatedAt"
FROM "hiring_competencies"
ON CONFLICT DO NOTHING;

-- DropForeignKey
ALTER TABLE "hiring_offer_approvals" DROP CONSTRAINT "hiring_offer_approvals_offerId_fkey";

-- DropForeignKey
ALTER TABLE "hive_email_templates" DROP CONSTRAINT "hive_email_templates_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "hive_escalation_reply_tokens" DROP CONSTRAINT "hive_escalation_reply_tokens_escalationId_fkey";

-- DropForeignKey
ALTER TABLE "hive_ticket_settings" DROP CONSTRAINT "hive_ticket_settings_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "jml_email_template_overrides" DROP CONSTRAINT "jml_email_template_overrides_updated_by_id_fkey";

-- DropTable
DROP TABLE "hiring_competencies";

-- DropTable
DROP TABLE "hiring_grades";

-- DropTable
DROP TABLE "hiring_import_batches";

-- DropTable
DROP TABLE "hiring_offer_approvals";

-- DropTable
DROP TABLE "hiring_settings";

-- DropTable
DROP TABLE "hive_email_templates";

-- DropTable
DROP TABLE "hive_escalation_reply_tokens";

-- DropTable
DROP TABLE "hive_ticket_settings";

-- DropTable
DROP TABLE "jml_email_template_overrides";

