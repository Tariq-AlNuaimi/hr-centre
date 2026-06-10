-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('ANTHROPIC', 'OPENAI_COMPATIBLE');

-- CreateTable
CREATE TABLE "ai_provider_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" "AiProvider" NOT NULL DEFAULT 'ANTHROPIC',
    "baseUrl" TEXT,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_config_pkey" PRIMARY KEY ("id")
);

