-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "valueEncrypted" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_settings_orgId_idx" ON "app_settings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_orgId_key_key" ON "app_settings"("orgId", "key");

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
