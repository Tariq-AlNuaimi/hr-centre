-- HR tickets — the HIVE port (docs/blueprints/hive.md), slice 1: data model.
--
-- Additive only: new hive_ tables + enums, and two new values on the core
-- "ScopeType" enum (HR_PAIR, OWN_HR_PAIR) so the role builder can scope ticket
-- permissions to an HR Tag pair. Nothing existing is altered or dropped.
-- (Generated with `prisma migrate dev --create-only`, then hand-edited: the
-- generator's unrelated `DROP TABLE "document_embedding"` — a raw-SQL pgvector
-- table no model describes — was removed.)

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'SEND_FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EscalationEventKind" AS ENUM ('OPENED', 'DRAFT_SAVED', 'SUBMITTED', 'RETURNED', 'APPROVED', 'SENT', 'SEND_FAILED', 'REOPENED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EscalationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EscalationSource" AS ENUM ('HIVE', 'SIRAAJ');

-- CreateEnum
CREATE TYPE "RotationAnchorType" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "RotationMode" AS ENUM ('CONSTANT', 'GROUP_1', 'GROUP_2');

-- CreateEnum
CREATE TYPE "DiscountEligibility" AS ENUM ('ALL', 'FEMALE_ONLY', 'FEMALE_PLUS_FAMILY');

-- CreateEnum
CREATE TYPE "HiveOrgUnitKind" AS ENUM ('COMPANY', 'DIRECTORATE', 'DEPARTMENT', 'TEAM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScopeType" ADD VALUE 'HR_PAIR';
ALTER TYPE "ScopeType" ADD VALUE 'OWN_HR_PAIR';

-- CreateTable
CREATE TABLE "hive_escalations" (
    "id" TEXT NOT NULL,
    "ticketNumber" SERIAL NOT NULL,
    "hrPairId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeEmail" TEXT NOT NULL,
    "employeeId" TEXT,
    "question" TEXT NOT NULL,
    "source" "EscalationSource" NOT NULL DEFAULT 'HIVE',
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "draftAnswer" TEXT,
    "draftedById" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "threadKey" TEXT NOT NULL,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_escalation_events" (
    "id" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "kind" "EscalationEventKind" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_escalation_messages" (
    "id" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "direction" "EscalationDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_escalation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_escalation_reply_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_escalation_reply_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_hr_tag_pairs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_hr_tag_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_hr_tag_members" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "photoKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_hr_tag_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_hr_tag_coverage" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityId" TEXT,
    "companyWide" BOOLEAN NOT NULL DEFAULT false,
    "directorateId" TEXT,
    "departmentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_hr_tag_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_rotation_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "anchorDate" DATE NOT NULL,
    "anchorType" "RotationAnchorType" NOT NULL DEFAULT 'A',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Muscat',
    "weekendDays" INTEGER[] DEFAULT ARRAY[5, 6]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_rotation_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_rotation_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "RotationMode" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_rotation_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_rotation_coverage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityId" TEXT,
    "directorateId" TEXT,
    "departmentId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_rotation_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_discount_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "offerSummary" TEXT NOT NULL,
    "eligibility" "DiscountEligibility" NOT NULL DEFAULT 'ALL',
    "validUntil" DATE,
    "redemption" TEXT,
    "onlineOnly" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_discount_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_network_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT,
    "location" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_network_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_email_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_ticket_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "ticketPrefix" TEXT NOT NULL DEFAULT 'HIVE',
    "statusLabels" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_ticket_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_org_unit_info" (
    "id" TEXT NOT NULL,
    "kind" "HiveOrgUnitKind" NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaderName" TEXT,
    "leaderTitle" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_org_unit_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hive_escalations_ticketNumber_key" ON "hive_escalations"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hive_escalations_threadKey_key" ON "hive_escalations"("threadKey");

-- CreateIndex
CREATE INDEX "hive_escalations_status_createdAt_idx" ON "hive_escalations"("status", "createdAt");

-- CreateIndex
CREATE INDEX "hive_escalations_employeeEmail_createdAt_idx" ON "hive_escalations"("employeeEmail", "createdAt");

-- CreateIndex
CREATE INDEX "hive_escalations_hrPairId_status_idx" ON "hive_escalations"("hrPairId", "status");

-- CreateIndex
CREATE INDEX "hive_escalations_employeeId_idx" ON "hive_escalations"("employeeId");

-- CreateIndex
CREATE INDEX "hive_escalations_draftedById_idx" ON "hive_escalations"("draftedById");

-- CreateIndex
CREATE INDEX "hive_escalations_approvedById_idx" ON "hive_escalations"("approvedById");

-- CreateIndex
CREATE INDEX "hive_escalations_submittedById_idx" ON "hive_escalations"("submittedById");

-- CreateIndex
CREATE INDEX "hive_escalation_events_escalationId_at_idx" ON "hive_escalation_events"("escalationId", "at");

-- CreateIndex
CREATE INDEX "hive_escalation_events_actorId_idx" ON "hive_escalation_events"("actorId");

-- CreateIndex
CREATE INDEX "hive_escalation_messages_escalationId_at_idx" ON "hive_escalation_messages"("escalationId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "hive_escalation_reply_tokens_tokenHash_key" ON "hive_escalation_reply_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "hive_escalation_reply_tokens_escalationId_expiresAt_idx" ON "hive_escalation_reply_tokens"("escalationId", "expiresAt");

-- CreateIndex
CREATE INDEX "hive_hr_tag_pairs_deletedAt_createdAt_idx" ON "hive_hr_tag_pairs"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hive_hr_tag_members_userId_key" ON "hive_hr_tag_members"("userId");

-- CreateIndex
CREATE INDEX "hive_hr_tag_members_pairId_order_idx" ON "hive_hr_tag_members"("pairId", "order");

-- CreateIndex
CREATE INDEX "hive_hr_tag_members_deletedAt_createdAt_idx" ON "hive_hr_tag_members"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_hr_tag_coverage_pairId_idx" ON "hive_hr_tag_coverage"("pairId");

-- CreateIndex
CREATE INDEX "hive_hr_tag_coverage_entityId_idx" ON "hive_hr_tag_coverage"("entityId");

-- CreateIndex
CREATE INDEX "hive_hr_tag_coverage_deletedAt_createdAt_idx" ON "hive_hr_tag_coverage"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_rotation_groups_deletedAt_createdAt_idx" ON "hive_rotation_groups"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_rotation_coverage_groupId_idx" ON "hive_rotation_coverage"("groupId");

-- CreateIndex
CREATE INDEX "hive_rotation_coverage_deletedAt_createdAt_idx" ON "hive_rotation_coverage"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_discount_partners_validUntil_idx" ON "hive_discount_partners"("validUntil");

-- CreateIndex
CREATE INDEX "hive_discount_partners_deletedAt_createdAt_idx" ON "hive_discount_partners"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_network_providers_location_idx" ON "hive_network_providers"("location");

-- CreateIndex
CREATE INDEX "hive_network_providers_deletedAt_createdAt_idx" ON "hive_network_providers"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hive_email_templates_key_key" ON "hive_email_templates"("key");

-- CreateIndex
CREATE INDEX "hive_email_templates_updatedById_idx" ON "hive_email_templates"("updatedById");

-- CreateIndex
CREATE INDEX "hive_email_templates_deletedAt_createdAt_idx" ON "hive_email_templates"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hive_ticket_settings_updatedById_idx" ON "hive_ticket_settings"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "hive_org_unit_info_kind_unitId_key" ON "hive_org_unit_info"("kind", "unitId");

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_hrPairId_fkey" FOREIGN KEY ("hrPairId") REFERENCES "hive_hr_tag_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_draftedById_fkey" FOREIGN KEY ("draftedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalation_events" ADD CONSTRAINT "hive_escalation_events_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "hive_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalation_events" ADD CONSTRAINT "hive_escalation_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalation_messages" ADD CONSTRAINT "hive_escalation_messages_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "hive_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_escalation_reply_tokens" ADD CONSTRAINT "hive_escalation_reply_tokens_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "hive_escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_hr_tag_members" ADD CONSTRAINT "hive_hr_tag_members_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "hive_hr_tag_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_hr_tag_members" ADD CONSTRAINT "hive_hr_tag_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_hr_tag_coverage" ADD CONSTRAINT "hive_hr_tag_coverage_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "hive_hr_tag_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_rotation_coverage" ADD CONSTRAINT "hive_rotation_coverage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "hive_rotation_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_email_templates" ADD CONSTRAINT "hive_email_templates_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_ticket_settings" ADD CONSTRAINT "hive_ticket_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provider search (HIVE §2.13): pg_trgm `similarity()` on the name. The GIN
-- index is raw SQL because `gin_trgm_ops` needs Prisma's preview
-- postgresqlExtensions flag. (The similarity() predicate seq-scans ~464 rows by
-- design; the index serves `%` / ILIKE lookups.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "hive_network_providers_name_trgm_idx"
  ON "hive_network_providers" USING GIN ("name" gin_trgm_ops);

-- A company-wide coverage row must name its company (Prisma cannot express it).
ALTER TABLE "hive_hr_tag_coverage"
  ADD CONSTRAINT "hive_hr_tag_coverage_company_wide_needs_entity"
  CHECK (NOT "companyWide" OR "entityId" IS NOT NULL);

-- Ticket numbers never repeat (HIVE spec V2 §8.6). The old HIVE app keeps
-- running until cut-over and its tickets (HIVE-0001 …) are not copied here, so
-- HR Centre starts its sequence at 1001: a number an employee already holds
-- from the old app is never issued again under the same prefix.
ALTER SEQUENCE "hive_escalations_ticketNumber_seq" RESTART WITH 1001;
