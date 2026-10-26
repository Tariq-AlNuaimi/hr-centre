-- CreateEnum
CREATE TYPE "HiringRequisitionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'FILLED', 'REOPENED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HiringJdStatus" AS ENUM ('DRAFT', 'AWAITING_SIGNOFF', 'CHANGES_REQUESTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "HiringJdSignatory" AS ENUM ('HIRING_MANAGER', 'HR');

-- CreateEnum
CREATE TYPE "HiringJdSignoffAction" AS ENUM ('SIGNED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "HiringStage" AS ENUM ('NEW_APPLICATION', 'CV_SCREENED', 'SHORTLISTED', 'ASSESSMENT', 'FIRST_INTERVIEW', 'SECOND_INTERVIEW', 'FINAL_INTERVIEW', 'REFERENCE_CHECK', 'BACKGROUND_CHECK', 'DECISION_PENDING', 'OFFER_DRAFTED', 'OFFER_EXTENDED', 'OFFER_ACCEPTED', 'PRE_ONBOARDING', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "HiringInterviewRound" AS ENUM ('SCREENING', 'TECHNICAL', 'PANEL', 'FINAL');

-- CreateEnum
CREATE TYPE "HiringInterviewStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HiringNotetakerStatus" AS ENUM ('NO_TRANSCRIPT', 'AI_UNCONFIGURED', 'SKIPPED_NO_CONSENT', 'DRAFTED', 'FAILED');

-- CreateEnum
CREATE TYPE "HiringVote" AS ENUM ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE');

-- CreateEnum
CREATE TYPE "HiringOfferStatus" AS ENUM ('DRAFTING', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "HiringNegotiationKind" AS ENUM ('PRE_OFFER_ALIGNMENT', 'NEGOTIATION');

-- CreateEnum
CREATE TYPE "HiringStallCause" AS ENUM ('SCORECARDS_OUTSTANDING', 'AWAITING_APPROVAL', 'AWAITING_CANDIDATE', 'AWAITING_SCHEDULING', 'AWAITING_DOCUMENTS', 'ROLE_ON_HOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "HiringApprovalAction" AS ENUM ('APPROVED', 'REJECTED', 'SENT_BACK');

-- CreateEnum
CREATE TYPE "HiringApprovalRole" AS ENUM ('HR_MANAGER', 'HR_SPECIALIST', 'HIRING_MANAGER', 'PANELIST', 'DEPARTMENT_HEAD', 'DIRECTOR', 'OPERATIONS_MANAGER', 'OPERATIONS_DIRECTOR', 'COO', 'CEO');

-- CreateEnum
CREATE TYPE "HiringCandidateSource" AS ENUM ('CAREERS_PAGE', 'MANUAL_ENTRY', 'LINKEDIN_PASTE', 'AGENCY', 'REFERRAL', 'INTERNAL', 'DIRECT_SOURCING', 'TAWTEEN', 'OTHER');

-- CreateEnum
CREATE TYPE "HiringDocumentKind" AS ENUM ('PAYSLIP', 'BANK_STATEMENT', 'EMPLOYMENT_CONTRACT', 'CERTIFICATE', 'ID_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "HiringPackageStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'RECEIVED', 'DECLINED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "HiringPostingChannel" AS ENUM ('CAREERS_PAGE', 'LINKEDIN', 'AGENCY', 'REFERRAL', 'TAWTEEN', 'INTERNAL');

-- CreateEnum
CREATE TYPE "HiringPostingState" AS ENUM ('LIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "HiringHandoverKind" AS ENUM ('TRANSFERRED', 'RETAINED');

-- CreateEnum
CREATE TYPE "HiringJobStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "HiringAssessmentStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HiringPlanningRoundStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "HiringNeedStatus" AS ENUM ('ASKED', 'NO_RESPONSE', 'SUBMITTED', 'CHALLENGE_AGREED', 'NO_NEED');

-- CreateTable
CREATE TABLE "hiring_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_requisitions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "departmentId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "competencies" TEXT[],
    "hiringManagerId" TEXT NOT NULL,
    "targetCloseDate" TIMESTAMP(3),
    "salaryBandMin" DECIMAL(12,3),
    "salaryBandMax" DECIMAL(12,3),
    "salaryCurrency" TEXT NOT NULL DEFAULT 'OMR',
    "grade" TEXT,
    "status" "HiringRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "businessNeed" TEXT,
    "alternativesConsidered" TEXT,
    "hmSeesSalary" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "departmentNeedId" TEXT,
    "jdVersion" INTEGER NOT NULL DEFAULT 1,
    "jdStatus" "HiringJdStatus" NOT NULL DEFAULT 'DRAFT',
    "jdAuthorId" TEXT,
    "jdApprovedAt" TIMESTAMP(3),
    "jdTemplateTitle" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_postings" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "channel" "HiringPostingChannel" NOT NULL,
    "state" "HiringPostingState" NOT NULL DEFAULT 'LIVE',
    "detail" TEXT,
    "omaniPreferred" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_requisition_status_history" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "fromStatus" "HiringRequisitionStatus" NOT NULL,
    "toStatus" "HiringRequisitionStatus" NOT NULL,
    "changedById" TEXT,
    "reason" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_requisition_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_requisition_approvals" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requiredRole" "HiringApprovalRole" NOT NULL,
    "approverId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_requisition_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_jd_signoffs" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" "HiringJdSignoffAction" NOT NULL,
    "signatory" "HiringJdSignatory",
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_jd_signoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_candidates" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "nationality" TEXT,
    "currentEmployer" TEXT,
    "linkedinUrl" TEXT,
    "cvBlobPathname" TEXT,
    "cvFileName" TEXT,
    "deiGender" TEXT,
    "deiEthnicity" TEXT,
    "profileData" JSONB,
    "necEnc" TEXT,
    "salaryExpectationEnc" TEXT,
    "source" "HiringCandidateSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "sourceAttribution" TEXT,
    "referredById" TEXT,
    "packageStatus" "HiringPackageStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "packageRequestedAt" TIMESTAMP(3),
    "packageDeclinedAt" TIMESTAMP(3),
    "packageDeclinedReason" TEXT,
    "packageConfirmedAt" TIMESTAMP(3),
    "packageConfirmedById" TEXT,
    "fitScores" JSONB,
    "overallScore" DOUBLE PRECISION DEFAULT 0,
    "aiRationale" TEXT,
    "aiWhyNot" TEXT,
    "stage" "HiringStage" NOT NULL DEFAULT 'NEW_APPLICATION',
    "rejectionReason" TEXT,
    "rejectionNotes" TEXT,
    "rejectionNoticeSentAt" TIMESTAMP(3),
    "rejectionHoldUntil" TIMESTAMP(3),
    "stallCause" "HiringStallCause",
    "stallNote" TEXT,
    "stallCauseAt" TIMESTAMP(3),
    "stallCauseById" TEXT,
    "stallCauseStage" "HiringStage",
    "preferredAt" TIMESTAMP(3),
    "preferredById" TEXT,
    "preferredNote" TEXT,
    "preferredOutstandingScorecards" INTEGER,
    "agencyName" TEXT,
    "agencyInviteId" TEXT,
    "agencySubmissionNote" TEXT,
    "consentAt" TIMESTAMP(3),
    "noticeVersion" TEXT,
    "employeeId" TEXT,
    "erasedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_stage_history" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "fromStage" "HiringStage" NOT NULL,
    "toStage" "HiringStage" NOT NULL,
    "movedById" TEXT,
    "reason" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_interviews" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "round" "HiringInterviewRound" NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "meetingLink" TEXT,
    "status" "HiringInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "transcript" TEXT,
    "notes" TEXT,
    "aiAnalysis" JSONB,
    "recordingUrl" TEXT,
    "notetakerDraft" TEXT,
    "notetakerStatus" "HiringNotetakerStatus",
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_interview_panelists" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "hiring_interview_panelists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_round_plans" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "round" "HiringInterviewRound" NOT NULL,
    "roundOrder" INTEGER NOT NULL,
    "competencies" TEXT[],
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_round_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_scorecards" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "panelistId" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "strengths" TEXT,
    "concerns" TEXT,
    "vote" "HiringVote" NOT NULL,
    "notes" TEXT,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_questions" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT,
    "roleFamily" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "competency" TEXT,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_offers" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "salaryEnc" TEXT,
    "allowancesEnc" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "probationMonths" INTEGER NOT NULL DEFAULT 3,
    "noticePeriod" TEXT DEFAULT '1 month',
    "contractType" TEXT DEFAULT 'Permanent',
    "status" "HiringOfferStatus" NOT NULL DEFAULT 'DRAFTING',
    "benefits" TEXT,
    "signedBlobPathname" TEXT,
    "signedFileName" TEXT,
    "signedSizeBytes" INTEGER,
    "signedAt" TIMESTAMP(3),
    "joiningDate" TIMESTAMP(3),
    "noticeDetail" TEXT,
    "countersignedBy" TEXT,
    "countersignedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "approvalChain" JSONB,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_offer_approvals" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "sequence" INTEGER,
    "requiredRole" "HiringApprovalRole",
    "action" "HiringApprovalAction",
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_offer_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_offer_versions" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "termsSnapshotEnc" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changedFields" TEXT[],
    "compChanged" BOOLEAN NOT NULL DEFAULT false,
    "restartedApproval" BOOLEAN NOT NULL DEFAULT false,
    "candidateNote" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_offer_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_negotiation_notes" (
    "id" TEXT NOT NULL,
    "offerId" TEXT,
    "candidateId" TEXT NOT NULL,
    "kind" "HiringNegotiationKind" NOT NULL DEFAULT 'NEGOTIATION',
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "discussedSalaryEnc" TEXT,
    "discussedStartDate" TIMESTAMP(3),
    "candidateConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_negotiation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_handovers" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "HiringHandoverKind" NOT NULL,
    "fromUserId" TEXT,
    "fromRole" TEXT,
    "toUserId" TEXT NOT NULL,
    "toRole" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_agency_invites" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "requisitionId" TEXT,
    "entityId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxSubmissions" INTEGER NOT NULL DEFAULT 20,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_agency_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_candidate_documents" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "HiringDocumentKind" NOT NULL,
    "label" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "blobPathname" TEXT,
    "statedAmountEnc" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'OMR',
    "uploadedById" TEXT,
    "fromCandidate" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_candidate_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_competencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT,
    "category" TEXT,
    "roleFamily" TEXT,
    "entityId" TEXT,
    "anchors" JSONB,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_grades" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSalary" DECIMAL(12,3),
    "maxSalary" DECIMAL(12,3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "entityId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_jd_templates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleFamily" TEXT,
    "description" TEXT NOT NULL,
    "competencies" TEXT[],
    "grade" TEXT,
    "entityId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_jd_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_ai_insights" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT,
    "output" JSONB NOT NULL,
    "summary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_ai_usage" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_import_batches" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "HiringJobStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_bulk_jobs" (
    "id" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "status" "HiringJobStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_bulk_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_assessments" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "status" "HiringAssessmentStatus" NOT NULL DEFAULT 'INVITED',
    "score" INTEGER,
    "percentile" INTEGER,
    "completedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "interviewFocus" TEXT,
    "validUntil" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_planning_rounds" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "HiringPlanningRoundStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_planning_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_department_needs" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "ownerId" TEXT,
    "status" "HiringNeedStatus" NOT NULL DEFAULT 'ASKED',
    "rolesRequested" INTEGER,
    "agreedRoles" INTEGER,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chasedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "discussedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_department_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_need_notes" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_need_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hiring_settings_key_key" ON "hiring_settings"("key");

-- CreateIndex
CREATE INDEX "hiring_requisitions_deletedAt_createdAt_idx" ON "hiring_requisitions"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_requisitions_entityId_idx" ON "hiring_requisitions"("entityId");

-- CreateIndex
CREATE INDEX "hiring_requisitions_departmentId_idx" ON "hiring_requisitions"("departmentId");

-- CreateIndex
CREATE INDEX "hiring_requisitions_hiringManagerId_idx" ON "hiring_requisitions"("hiringManagerId");

-- CreateIndex
CREATE INDEX "hiring_requisitions_ownerId_idx" ON "hiring_requisitions"("ownerId");

-- CreateIndex
CREATE INDEX "hiring_requisitions_grade_idx" ON "hiring_requisitions"("grade");

-- CreateIndex
CREATE INDEX "hiring_requisitions_status_targetCloseDate_idx" ON "hiring_requisitions"("status", "targetCloseDate");

-- CreateIndex
CREATE INDEX "hiring_requisitions_status_jdApprovedAt_idx" ON "hiring_requisitions"("status", "jdApprovedAt");

-- CreateIndex
CREATE INDEX "hiring_requisitions_departmentNeedId_idx" ON "hiring_requisitions"("departmentNeedId");

-- CreateIndex
CREATE INDEX "hiring_postings_channel_state_idx" ON "hiring_postings"("channel", "state");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_postings_requisitionId_channel_key" ON "hiring_postings"("requisitionId", "channel");

-- CreateIndex
CREATE INDEX "hiring_requisition_status_history_requisitionId_changedAt_idx" ON "hiring_requisition_status_history"("requisitionId", "changedAt");

-- CreateIndex
CREATE INDEX "hiring_requisition_approvals_requisitionId_idx" ON "hiring_requisition_approvals"("requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_requisition_approvals_submissionId_sequence_key" ON "hiring_requisition_approvals"("submissionId", "sequence");

-- CreateIndex
CREATE INDEX "hiring_jd_signoffs_requisitionId_createdAt_idx" ON "hiring_jd_signoffs"("requisitionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_jd_signoffs_requisitionId_version_signatory_key" ON "hiring_jd_signoffs"("requisitionId", "version", "signatory");

-- CreateIndex
CREATE INDEX "hiring_candidates_deletedAt_createdAt_idx" ON "hiring_candidates"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_candidates_requisitionId_idx" ON "hiring_candidates"("requisitionId");

-- CreateIndex
CREATE INDEX "hiring_candidates_source_idx" ON "hiring_candidates"("source");

-- CreateIndex
CREATE INDEX "hiring_candidates_referredById_idx" ON "hiring_candidates"("referredById");

-- CreateIndex
CREATE INDEX "hiring_candidates_email_idx" ON "hiring_candidates"("email");

-- CreateIndex
CREATE INDEX "hiring_candidates_requisitionId_preferredAt_idx" ON "hiring_candidates"("requisitionId", "preferredAt");

-- CreateIndex
CREATE INDEX "hiring_candidates_agencyInviteId_idx" ON "hiring_candidates"("agencyInviteId");

-- CreateIndex
CREATE INDEX "hiring_candidates_stage_updatedAt_idx" ON "hiring_candidates"("stage", "updatedAt");

-- CreateIndex
CREATE INDEX "hiring_candidates_stage_createdAt_idx" ON "hiring_candidates"("stage", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_candidates_rejectionHoldUntil_rejectionNoticeSentAt_idx" ON "hiring_candidates"("rejectionHoldUntil", "rejectionNoticeSentAt");

-- CreateIndex
CREATE INDEX "hiring_candidates_overallScore_idx" ON "hiring_candidates"("overallScore");

-- CreateIndex
CREATE INDEX "hiring_candidates_employeeId_idx" ON "hiring_candidates"("employeeId");

-- CreateIndex
CREATE INDEX "hiring_stage_history_candidateId_movedAt_idx" ON "hiring_stage_history"("candidateId", "movedAt");

-- CreateIndex
CREATE INDEX "hiring_interviews_deletedAt_createdAt_idx" ON "hiring_interviews"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_interviews_requisitionId_idx" ON "hiring_interviews"("requisitionId");

-- CreateIndex
CREATE INDEX "hiring_interviews_candidateId_idx" ON "hiring_interviews"("candidateId");

-- CreateIndex
CREATE INDEX "hiring_interviews_status_idx" ON "hiring_interviews"("status");

-- CreateIndex
CREATE INDEX "hiring_interviews_scheduledDate_status_idx" ON "hiring_interviews"("scheduledDate", "status");

-- CreateIndex
CREATE INDEX "hiring_interview_panelists_userId_idx" ON "hiring_interview_panelists"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_interview_panelists_interviewId_userId_key" ON "hiring_interview_panelists"("interviewId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_round_plans_requisitionId_round_key" ON "hiring_round_plans"("requisitionId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_round_plans_requisitionId_roundOrder_key" ON "hiring_round_plans"("requisitionId", "roundOrder");

-- CreateIndex
CREATE INDEX "hiring_scorecards_deletedAt_createdAt_idx" ON "hiring_scorecards"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_scorecards_candidateId_idx" ON "hiring_scorecards"("candidateId");

-- CreateIndex
CREATE INDEX "hiring_scorecards_panelistId_idx" ON "hiring_scorecards"("panelistId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_scorecards_interviewId_panelistId_key" ON "hiring_scorecards"("interviewId", "panelistId");

-- CreateIndex
CREATE INDEX "hiring_questions_deletedAt_createdAt_idx" ON "hiring_questions"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_questions_roleFamily_idx" ON "hiring_questions"("roleFamily");

-- CreateIndex
CREATE INDEX "hiring_offers_deletedAt_createdAt_idx" ON "hiring_offers"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_offers_candidateId_idx" ON "hiring_offers"("candidateId");

-- CreateIndex
CREATE INDEX "hiring_offers_requisitionId_idx" ON "hiring_offers"("requisitionId");

-- CreateIndex
CREATE INDEX "hiring_offers_status_idx" ON "hiring_offers"("status");

-- CreateIndex
CREATE INDEX "hiring_offer_approvals_approverId_idx" ON "hiring_offer_approvals"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_offer_approvals_offerId_sequence_key" ON "hiring_offer_approvals"("offerId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_offer_versions_offerId_versionNumber_key" ON "hiring_offer_versions"("offerId", "versionNumber");

-- CreateIndex
CREATE INDEX "hiring_negotiation_notes_offerId_createdAt_idx" ON "hiring_negotiation_notes"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_negotiation_notes_candidateId_createdAt_idx" ON "hiring_negotiation_notes"("candidateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_handovers_candidateId_key" ON "hiring_handovers"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_agency_invites_tokenHash_key" ON "hiring_agency_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "hiring_agency_invites_requisitionId_idx" ON "hiring_agency_invites"("requisitionId");

-- CreateIndex
CREATE INDEX "hiring_candidate_documents_candidateId_kind_idx" ON "hiring_candidate_documents"("candidateId", "kind");

-- CreateIndex
CREATE INDEX "hiring_competencies_deletedAt_createdAt_idx" ON "hiring_competencies"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_competencies_name_idx" ON "hiring_competencies"("name");

-- CreateIndex
CREATE INDEX "hiring_grades_deletedAt_createdAt_idx" ON "hiring_grades"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_grades_code_idx" ON "hiring_grades"("code");

-- CreateIndex
CREATE INDEX "hiring_jd_templates_deletedAt_createdAt_idx" ON "hiring_jd_templates"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_jd_templates_title_idx" ON "hiring_jd_templates"("title");

-- CreateIndex
CREATE INDEX "hiring_ai_insights_entityType_entityId_kind_idx" ON "hiring_ai_insights"("entityType", "entityId", "kind");

-- CreateIndex
CREATE INDEX "hiring_ai_usage_createdAt_idx" ON "hiring_ai_usage"("createdAt");

-- CreateIndex
CREATE INDEX "hiring_ai_usage_feature_createdAt_idx" ON "hiring_ai_usage"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "hiring_import_batches_createdAt_idx" ON "hiring_import_batches"("createdAt");

-- CreateIndex
CREATE INDEX "hiring_bulk_jobs_deletedAt_createdAt_idx" ON "hiring_bulk_jobs"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_assessments_candidateId_key" ON "hiring_assessments"("candidateId");

-- CreateIndex
CREATE INDEX "hiring_assessments_status_invitedAt_idx" ON "hiring_assessments"("status", "invitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_planning_rounds_entityId_label_key" ON "hiring_planning_rounds"("entityId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_department_needs_roundId_departmentId_key" ON "hiring_department_needs"("roundId", "departmentId");

-- CreateIndex
CREATE INDEX "hiring_need_notes_needId_createdAt_idx" ON "hiring_need_notes"("needId", "createdAt");

-- AddForeignKey
ALTER TABLE "hiring_requisitions" ADD CONSTRAINT "hiring_requisitions_departmentNeedId_fkey" FOREIGN KEY ("departmentNeedId") REFERENCES "hiring_department_needs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_postings" ADD CONSTRAINT "hiring_postings_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_requisition_status_history" ADD CONSTRAINT "hiring_requisition_status_history_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_requisition_approvals" ADD CONSTRAINT "hiring_requisition_approvals_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_requisition_approvals" ADD CONSTRAINT "hiring_requisition_approvals_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "hiring_requisition_status_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_jd_signoffs" ADD CONSTRAINT "hiring_jd_signoffs_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_candidates" ADD CONSTRAINT "hiring_candidates_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_candidates" ADD CONSTRAINT "hiring_candidates_agencyInviteId_fkey" FOREIGN KEY ("agencyInviteId") REFERENCES "hiring_agency_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_stage_history" ADD CONSTRAINT "hiring_stage_history_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_interviews" ADD CONSTRAINT "hiring_interviews_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_interview_panelists" ADD CONSTRAINT "hiring_interview_panelists_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "hiring_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_round_plans" ADD CONSTRAINT "hiring_round_plans_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_scorecards" ADD CONSTRAINT "hiring_scorecards_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "hiring_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_scorecards" ADD CONSTRAINT "hiring_scorecards_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_questions" ADD CONSTRAINT "hiring_questions_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_offers" ADD CONSTRAINT "hiring_offers_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_offers" ADD CONSTRAINT "hiring_offers_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_offer_approvals" ADD CONSTRAINT "hiring_offer_approvals_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hiring_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_offer_versions" ADD CONSTRAINT "hiring_offer_versions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hiring_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_negotiation_notes" ADD CONSTRAINT "hiring_negotiation_notes_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "hiring_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_negotiation_notes" ADD CONSTRAINT "hiring_negotiation_notes_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_handovers" ADD CONSTRAINT "hiring_handovers_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_agency_invites" ADD CONSTRAINT "hiring_agency_invites_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "hiring_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_candidate_documents" ADD CONSTRAINT "hiring_candidate_documents_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_assessments" ADD CONSTRAINT "hiring_assessments_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hiring_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_department_needs" ADD CONSTRAINT "hiring_department_needs_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "hiring_planning_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_need_notes" ADD CONSTRAINT "hiring_need_notes_needId_fkey" FOREIGN KEY ("needId") REFERENCES "hiring_department_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
