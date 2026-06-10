-- CreateTable
CREATE TABLE "browser_engine_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "projectId" TEXT,
    "apiKeyEnc" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_engine_config_pkey" PRIMARY KEY ("id")
);

