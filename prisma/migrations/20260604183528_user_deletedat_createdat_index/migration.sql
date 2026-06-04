-- DropIndex
DROP INDEX "users_deletedAt_idx";

-- CreateIndex
CREATE INDEX "users_deletedAt_createdAt_idx" ON "users"("deletedAt", "createdAt");
