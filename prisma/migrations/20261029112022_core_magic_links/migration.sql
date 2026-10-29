-- CreateTable
CREATE TABLE "core_magic_links" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "core_magic_links_token_hash_key" ON "core_magic_links"("token_hash");

-- CreateIndex
CREATE INDEX "core_magic_links_purpose_subject_id_expires_at_idx" ON "core_magic_links"("purpose", "subject_id", "expires_at");

-- ADR-090: copy every existing HR-ticket reply link into the core store, so
-- links already sitting in employees' mailboxes keep working. The digest, the
-- expiry, the revocation and the last use carry over unchanged; the old table
-- stays until the new path is verified live (dropped in a later migration).
INSERT INTO "core_magic_links" ("id", "purpose", "subject_id", "token_hash", "expires_at", "revoked_at", "last_used_at", "created_at")
SELECT t."id", 'hive.reply', t."escalationId", t."tokenHash", t."expiresAt", t."revokedAt", t."lastUsedAt", t."createdAt"
FROM "hive_escalation_reply_tokens" t
ON CONFLICT ("token_hash") DO NOTHING;
