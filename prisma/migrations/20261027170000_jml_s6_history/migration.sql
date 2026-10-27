-- JML S6c — historical exits (§26.2, F8): an imported exit keeps its coded
-- reasons as an interview row whose scores were never asked.

ALTER TYPE "LeaveInterviewConducted" ADD VALUE IF NOT EXISTS 'IMPORTED';

ALTER TABLE "leave_exit_interviews" ALTER COLUMN "recommend_score" DROP NOT NULL;
ALTER TABLE "leave_exit_interviews" ALTER COLUMN "return_score" DROP NOT NULL;
