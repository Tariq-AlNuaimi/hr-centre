-- DropIndex
DROP INDEX "core_approval_decisions_step_id_decider_id_key";

-- AlterTable
ALTER TABLE "core_approval_decisions" ADD COLUMN     "slot" VARCHAR(40);

-- AlterTable
ALTER TABLE "core_approval_requests" ADD COLUMN     "subject_version" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "core_approval_decisions_step_id_decider_id_action_key" ON "core_approval_decisions"("step_id", "decider_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "core_approval_decisions_step_id_slot_key" ON "core_approval_decisions"("step_id", "slot");


-- ADR-094 (follow-up): Hiring requisition approval and JD sign-off move onto the
-- core approvals engine. Every existing round is copied, so a requisition or JD
-- waiting for approval keeps its signatures and a decided one keeps its
-- history. `hiring_requisition_approvals` and `hiring_jd_signoffs` stay until
-- the new path is verified live (dropped in a later migration).
CREATE OR REPLACE FUNCTION pg_temp.role_label(r TEXT) RETURNS TEXT AS $$
  SELECT CASE WHEN r IN ('COO', 'CEO') THEN r ELSE
    upper(left(regexp_replace(lower(replace(r, '_', ' ')), '\mhr\M', 'HR'), 1)) ||
    substr(regexp_replace(lower(replace(r, '_', ' ')), '\mhr\M', 'HR'), 2) END
$$ LANGUAGE sql IMMUTABLE;

-- 1. Requisitions: one round per move INTO PENDING_APPROVAL; it closes with the
--    next move out of PENDING_APPROVAL (OPEN = approved; DRAFT with the
--    "Rejected — " / "Sent back — " note = that decision; anything else = cancelled).
CREATE TEMP TABLE mig_req_sub AS
SELECT h."id" AS sub_id, h."requisitionId" AS req_id, h."changedById" AS by_id, h."changedAt" AS at,
  r."title" AS title, r."status"::text AS req_status,
  row_number() OVER (PARTITION BY h."requisitionId" ORDER BY h."changedAt" DESC, h."id" DESC) AS rn,
  NULL::TEXT AS close_to, NULL::TEXT AS close_reason, NULL::TEXT AS close_by,
  NULL::TIMESTAMP(3) AS close_at, NULL::TEXT AS round_status
FROM "hiring_requisition_status_history" h
JOIN "hiring_requisitions" r ON r."id" = h."requisitionId"
WHERE h."toStatus" = 'PENDING_APPROVAL';

UPDATE mig_req_sub s
SET close_to = c.to_status, close_reason = c.reason, close_by = c.by_id, close_at = c.at
FROM (
  SELECT DISTINCT ON (s2.sub_id) s2.sub_id, h."toStatus"::text AS to_status, h."reason" AS reason,
    h."changedById" AS by_id, h."changedAt" AS at
  FROM mig_req_sub s2
  JOIN "hiring_requisition_status_history" h
    ON h."requisitionId" = s2.req_id AND h."fromStatus" = 'PENDING_APPROVAL'
   AND h."changedAt" >= s2.at AND h."id" <> s2.sub_id
  ORDER BY s2.sub_id, h."changedAt" ASC, h."id" ASC
) c
WHERE c.sub_id = s.sub_id;

UPDATE mig_req_sub SET round_status = CASE
  WHEN close_to IS NULL AND rn = 1 AND req_status = 'PENDING_APPROVAL' THEN 'PENDING'
  WHEN close_to = 'OPEN' THEN 'APPROVED'
  WHEN close_to = 'DRAFT' AND close_reason LIKE 'Rejected — %' THEN 'REJECTED'
  WHEN close_to = 'DRAFT' AND close_reason LIKE 'Sent back — %' THEN 'SENT_BACK'
  ELSE 'CANCELLED' END;

-- The steps: the fixed chain (HR Manager, then Operations Director), with the
-- role a recorded sign-off names winning for its sequence.
CREATE TEMP TABLE mig_req_steps AS
SELECT DISTINCT ON (sub_id, seq) sub_id, seq, role FROM (
  SELECT a."submissionId" AS sub_id, a."sequence" AS seq, a."requiredRole"::text AS role, 0 AS pri
  FROM "hiring_requisition_approvals" a JOIN mig_req_sub s ON s.sub_id = a."submissionId"
  UNION ALL
  SELECT s.sub_id, v.seq, v.role, 1 FROM mig_req_sub s
  CROSS JOIN (VALUES (1, 'HR_MANAGER'), (2, 'OPERATIONS_DIRECTOR')) AS v(seq, role)
) x
ORDER BY sub_id, seq, pri;

-- The first unsigned step of each round (the one waiting, or the one turned down).
CREATE TEMP TABLE mig_req_open_step AS
SELECT st.sub_id, min(st.seq) AS seq FROM mig_req_steps st
WHERE NOT EXISTS (SELECT 1 FROM "hiring_requisition_approvals" a WHERE a."submissionId" = st.sub_id AND a."sequence" = st.seq)
GROUP BY st.sub_id;

INSERT INTO "core_approval_requests" ("id", "module", "subject_type", "subject_id", "title", "href", "status", "submitted_by_id", "excluded_ids", "created_at", "closed_at")
SELECT 'mig_rq_' || s.sub_id, 'hiring', 'hiring.requisition', s.req_id, left(s.title, 200),
  '/hiring/requisitions/' || s.req_id || '/approval', s.round_status::"ApprovalRequestStatus",
  (SELECT u."id" FROM "users" u WHERE u."id" = s.by_id), ARRAY[]::TEXT[], s.at,
  CASE WHEN s.round_status = 'PENDING' THEN NULL ELSE COALESCE(s.close_at, s.at) END
FROM mig_req_sub s
ON CONFLICT DO NOTHING;

INSERT INTO "core_approval_steps" ("id", "request_id", "sequence", "role_key", "label", "required_approvals", "status", "decided_at")
SELECT 'mig_rq_' || st.sub_id || '_' || st.seq, 'mig_rq_' || st.sub_id, st.seq, st.role, pg_temp.role_label(st.role), 1,
  (CASE
     WHEN a."id" IS NOT NULL THEN 'APPROVED'
     WHEN o.seq = st.seq AND s.round_status IN ('PENDING', 'REJECTED', 'SENT_BACK')
       THEN CASE s.round_status WHEN 'PENDING' THEN 'CURRENT' ELSE s.round_status END
     WHEN s.round_status = 'PENDING' THEN 'WAITING'
     ELSE 'CANCELLED' END)::"ApprovalStepStatus",
  CASE WHEN a."id" IS NOT NULL THEN a."createdAt"
       WHEN o.seq = st.seq AND s.round_status IN ('REJECTED', 'SENT_BACK') THEN s.close_at END
FROM mig_req_steps st
JOIN mig_req_sub s ON s.sub_id = st.sub_id
LEFT JOIN mig_req_open_step o ON o.sub_id = st.sub_id
LEFT JOIN "hiring_requisition_approvals" a ON a."submissionId" = st.sub_id AND a."sequence" = st.seq
ON CONFLICT DO NOTHING;

INSERT INTO "core_approval_decisions" ("id", "request_id", "step_id", "decider_id", "action", "comment", "decided_at")
SELECT a."id", 'mig_rq_' || a."submissionId", 'mig_rq_' || a."submissionId" || '_' || a."sequence", a."approverId",
  'APPROVED'::"ApprovalAction", a."comment", a."createdAt"
FROM "hiring_requisition_approvals" a
JOIN mig_req_sub s ON s.sub_id = a."submissionId"
WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."approverId")
ON CONFLICT DO NOTHING;

-- The decision that turned a round down, by whoever recorded it.
INSERT INTO "core_approval_decisions" ("id", "request_id", "step_id", "decider_id", "action", "comment", "decided_at")
SELECT 'mig_rq_' || s.sub_id || '_close', 'mig_rq_' || s.sub_id, 'mig_rq_' || s.sub_id || '_' || o.seq, s.close_by,
  s.round_status::"ApprovalAction", s.close_reason, s.close_at
FROM mig_req_sub s
JOIN mig_req_open_step o ON o.sub_id = s.sub_id
WHERE s.round_status IN ('REJECTED', 'SENT_BACK')
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = s.close_by)
ON CONFLICT DO NOTHING;

-- 2. JD sign-off: one round per JD version that was signed, sent back or is
--    awaiting sign-off; one step needing two signatories; each signature names
--    its slot.
CREATE TEMP TABLE mig_jd AS
SELECT v.req_id, v.version, r."title" AS title, r."jdStatus"::text AS jd_status, r."jdVersion" AS cur_version,
  r."jdAuthorId" AS author, r."updatedAt" AS updated_at,
  (SELECT min(j."createdAt") FROM "hiring_jd_signoffs" j WHERE j."requisitionId" = v.req_id AND j."version" = v.version) AS first_at,
  (SELECT max(j."createdAt") FROM "hiring_jd_signoffs" j WHERE j."requisitionId" = v.req_id AND j."version" = v.version) AS last_at,
  (SELECT count(*) FROM "hiring_jd_signoffs" j WHERE j."requisitionId" = v.req_id AND j."version" = v.version AND j."action" = 'SIGNED') AS signed,
  (SELECT min(j."createdAt") FROM "hiring_jd_signoffs" j WHERE j."requisitionId" = v.req_id AND j."version" = v.version AND j."action" = 'CHANGES_REQUESTED') AS changes_at,
  NULL::TEXT AS round_status
FROM (
  SELECT DISTINCT "requisitionId" AS req_id, "version" FROM "hiring_jd_signoffs"
  UNION
  SELECT "id", "jdVersion" FROM "hiring_requisitions" WHERE "jdStatus" = 'AWAITING_SIGNOFF'
) v
JOIN "hiring_requisitions" r ON r."id" = v.req_id;

UPDATE mig_jd SET round_status = CASE
  WHEN version = cur_version AND jd_status = 'AWAITING_SIGNOFF' THEN 'PENDING'
  WHEN changes_at IS NOT NULL THEN 'SENT_BACK'
  WHEN signed >= 2 THEN 'APPROVED'
  ELSE 'CANCELLED' END;

INSERT INTO "core_approval_requests" ("id", "module", "subject_type", "subject_id", "subject_version", "title", "href", "status", "submitted_by_id", "excluded_ids", "created_at", "closed_at")
SELECT 'mig_jd_' || j.req_id || '_' || j.version, 'hiring', 'hiring.jd', j.req_id, j.version, left(j.title, 200),
  '/hiring/requisitions/' || j.req_id || '/jd', j.round_status::"ApprovalRequestStatus",
  CASE WHEN j.version = j.cur_version THEN (SELECT u."id" FROM "users" u WHERE u."id" = j.author) END,
  ARRAY[]::TEXT[], COALESCE(j.first_at, j.updated_at),
  CASE j.round_status
    WHEN 'PENDING' THEN NULL
    WHEN 'SENT_BACK' THEN j.changes_at
    ELSE COALESCE(j.last_at, j.updated_at) END
FROM mig_jd j
ON CONFLICT DO NOTHING;

INSERT INTO "core_approval_steps" ("id", "request_id", "sequence", "role_key", "label", "required_approvals", "status", "decided_at")
SELECT 'mig_jd_' || j.req_id || '_' || j.version || '_1', 'mig_jd_' || j.req_id || '_' || j.version, 1,
  'hiring.jd.signoff', 'Job description sign-off', 2,
  (CASE j.round_status WHEN 'PENDING' THEN 'CURRENT' ELSE j.round_status END)::"ApprovalStepStatus",
  CASE j.round_status
    WHEN 'PENDING' THEN NULL
    WHEN 'SENT_BACK' THEN j.changes_at
    WHEN 'APPROVED' THEN j.last_at END
FROM mig_jd j
ON CONFLICT DO NOTHING;

INSERT INTO "core_approval_decisions" ("id", "request_id", "step_id", "decider_id", "slot", "action", "comment", "decided_at")
SELECT s."id", 'mig_jd_' || s."requisitionId" || '_' || s."version",
  'mig_jd_' || s."requisitionId" || '_' || s."version" || '_1', s."actorId",
  CASE WHEN s."action" = 'SIGNED' THEN s."signatory"::text END,
  (CASE s."action" WHEN 'SIGNED' THEN 'APPROVED' ELSE 'SENT_BACK' END)::"ApprovalAction",
  s."comment", s."createdAt"
FROM "hiring_jd_signoffs" s
WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = s."actorId")
  AND EXISTS (SELECT 1 FROM "core_approval_steps" st WHERE st."id" = 'mig_jd_' || s."requisitionId" || '_' || s."version" || '_1')
ON CONFLICT DO NOTHING;

DROP TABLE mig_req_open_step;
DROP TABLE mig_req_steps;
DROP TABLE mig_req_sub;
DROP TABLE mig_jd;
