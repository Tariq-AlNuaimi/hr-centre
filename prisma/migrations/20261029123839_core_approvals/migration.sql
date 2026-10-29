-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SENT_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('WAITING', 'CURRENT', 'APPROVED', 'REJECTED', 'SENT_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVED', 'REJECTED', 'SENT_BACK');

-- CreateTable
CREATE TABLE "core_approval_requests" (
    "id" TEXT NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "subject_type" VARCHAR(40) NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by_id" TEXT,
    "excluded_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "core_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_approval_steps" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role_key" VARCHAR(60) NOT NULL,
    "label" TEXT NOT NULL,
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'WAITING',
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "core_approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_approval_decisions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "decider_id" TEXT NOT NULL,
    "on_behalf_of_id" TEXT,
    "via_proxy" BOOLEAN NOT NULL DEFAULT false,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_approval_delegations" (
    "id" TEXT NOT NULL,
    "delegator_id" TEXT NOT NULL,
    "delegate_id" TEXT NOT NULL,
    "module" VARCHAR(20),
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "core_approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "core_approval_requests_subject_type_subject_id_created_at_idx" ON "core_approval_requests"("subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "core_approval_requests_status_module_idx" ON "core_approval_requests"("status", "module");

-- CreateIndex
CREATE INDEX "core_approval_requests_submitted_by_id_idx" ON "core_approval_requests"("submitted_by_id");

-- CreateIndex
CREATE INDEX "core_approval_steps_status_idx" ON "core_approval_steps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "core_approval_steps_request_id_sequence_key" ON "core_approval_steps"("request_id", "sequence");

-- CreateIndex
CREATE INDEX "core_approval_decisions_request_id_idx" ON "core_approval_decisions"("request_id");

-- CreateIndex
CREATE INDEX "core_approval_decisions_decider_id_idx" ON "core_approval_decisions"("decider_id");

-- CreateIndex
CREATE INDEX "core_approval_decisions_on_behalf_of_id_idx" ON "core_approval_decisions"("on_behalf_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "core_approval_decisions_step_id_decider_id_key" ON "core_approval_decisions"("step_id", "decider_id");

-- CreateIndex
CREATE INDEX "core_approval_delegations_delegate_id_valid_until_idx" ON "core_approval_delegations"("delegate_id", "valid_until");

-- CreateIndex
CREATE INDEX "core_approval_delegations_delegator_id_idx" ON "core_approval_delegations"("delegator_id");

-- AddForeignKey
ALTER TABLE "core_approval_requests" ADD CONSTRAINT "core_approval_requests_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_steps" ADD CONSTRAINT "core_approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "core_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_decisions" ADD CONSTRAINT "core_approval_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "core_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_decisions" ADD CONSTRAINT "core_approval_decisions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "core_approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_decisions" ADD CONSTRAINT "core_approval_decisions_decider_id_fkey" FOREIGN KEY ("decider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_decisions" ADD CONSTRAINT "core_approval_decisions_on_behalf_of_id_fkey" FOREIGN KEY ("on_behalf_of_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_delegations" ADD CONSTRAINT "core_approval_delegations_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_approval_delegations" ADD CONSTRAINT "core_approval_delegations_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ADR-094: copy every Hiring offer approval round into the core engine, so an
-- offer waiting for approval keeps its chain and the decisions already taken,
-- and a decided offer keeps its approval history. `hiring_offer_approvals`
-- stays until the new path is verified live (dropped in a later migration).
CREATE OR REPLACE FUNCTION pg_temp.role_label(r TEXT) RETURNS TEXT AS $$
  SELECT CASE WHEN r IN ('COO', 'CEO') THEN r ELSE
    upper(left(regexp_replace(lower(replace(r, '_', ' ')), '\mhr\M', 'HR'), 1)) ||
    substr(regexp_replace(lower(replace(r, '_', ' ')), '\mhr\M', 'HR'), 2) END
$$ LANGUAGE sql IMMUTABLE;

-- 1. The steps of each round: the submitted chain where the offer still has one,
--    otherwise the steps the recorded decisions name (a sent-back round).
CREATE TEMP TABLE mig_offer_steps AS
SELECT o."id" AS offer_id, (e->>'sequence')::int AS seq, e->>'role' AS role
FROM "hiring_offers" o, jsonb_array_elements(o."approvalChain"::jsonb) e
WHERE o."approvalChain" IS NOT NULL AND jsonb_typeof(o."approvalChain"::jsonb) = 'array'
UNION
SELECT a."offerId", a."sequence", a."requiredRole"::text
FROM "hiring_offer_approvals" a JOIN "hiring_offers" o ON o."id" = a."offerId"
WHERE o."approvalChain" IS NULL AND a."sequence" IS NOT NULL AND a."requiredRole" IS NOT NULL;

CREATE TEMP TABLE mig_offer_rounds AS
SELECT o."id" AS offer_id, o."status"::text AS offer_status, o."submittedById" AS submitted_by,
  c."name" AS title, c."referredById" AS referrer, o."updatedAt" AS updated_at,
  (SELECT count(*) FROM mig_offer_steps s WHERE s.offer_id = o."id") AS steps,
  (SELECT count(*) FROM mig_offer_steps s WHERE s.offer_id = o."id" AND EXISTS (
     SELECT 1 FROM "hiring_offer_approvals" a WHERE a."offerId" = o."id" AND a."sequence" = s.seq AND a."action" = 'APPROVED')) AS approved,
  (SELECT a."action"::text FROM "hiring_offer_approvals" a WHERE a."offerId" = o."id" AND a."action" IN ('REJECTED', 'SENT_BACK') ORDER BY a."decidedAt" DESC NULLS LAST LIMIT 1) AS closing_action
FROM "hiring_offers" o JOIN "hiring_candidates" c ON c."id" = o."candidateId"
WHERE EXISTS (SELECT 1 FROM mig_offer_steps s WHERE s.offer_id = o."id");

INSERT INTO "core_approval_requests" ("id", "module", "subject_type", "subject_id", "title", "href", "status", "submitted_by_id", "excluded_ids", "created_at", "closed_at")
SELECT 'mig_' || r.offer_id, 'hiring', 'hiring.offer', r.offer_id, r.title, '/hiring/offers/' || r.offer_id,
  (CASE WHEN r.offer_status = 'PENDING_APPROVAL' THEN 'PENDING'
        WHEN r.closing_action IS NOT NULL THEN r.closing_action
        WHEN r.approved = r.steps THEN 'APPROVED'
        ELSE 'CANCELLED' END)::"ApprovalRequestStatus",
  (SELECT u."id" FROM "users" u WHERE u."id" = r.submitted_by),
  CASE WHEN r.referrer IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[r.referrer] END,
  r.updated_at,
  CASE WHEN r.offer_status = 'PENDING_APPROVAL' THEN NULL ELSE r.updated_at END
FROM mig_offer_rounds r;

INSERT INTO "core_approval_steps" ("id", "request_id", "sequence", "role_key", "label", "status", "decided_at")
SELECT 'mig_' || s.offer_id || '_' || s.seq, 'mig_' || s.offer_id, s.seq, s.role, pg_temp.role_label(s.role),
  (CASE
     WHEN a."action" IS NOT NULL THEN a."action"::text
     WHEN r.offer_status = 'PENDING_APPROVAL' AND s.seq = (
       SELECT min(s2.seq) FROM mig_offer_steps s2 WHERE s2.offer_id = s.offer_id AND NOT EXISTS (
         SELECT 1 FROM "hiring_offer_approvals" a2 WHERE a2."offerId" = s.offer_id AND a2."sequence" = s2.seq AND a2."action" = 'APPROVED'))
       THEN 'CURRENT'
     WHEN r.offer_status = 'PENDING_APPROVAL' THEN 'WAITING'
     ELSE 'CANCELLED' END)::"ApprovalStepStatus",
  a."decidedAt"
FROM mig_offer_steps s
JOIN mig_offer_rounds r ON r.offer_id = s.offer_id
LEFT JOIN "hiring_offer_approvals" a ON a."offerId" = s.offer_id AND a."sequence" = s.seq AND a."action" IS NOT NULL;

INSERT INTO "core_approval_decisions" ("id", "request_id", "step_id", "decider_id", "action", "comment", "decided_at")
SELECT a."id", 'mig_' || a."offerId", 'mig_' || a."offerId" || '_' || a."sequence", a."approverId", a."action"::text::"ApprovalAction", a."comment", COALESCE(a."decidedAt", a."createdAt")
FROM "hiring_offer_approvals" a
WHERE a."action" IS NOT NULL AND a."sequence" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "core_approval_steps" s WHERE s."id" = 'mig_' || a."offerId" || '_' || a."sequence")
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."approverId");

DROP TABLE mig_offer_steps;
DROP TABLE mig_offer_rounds;
