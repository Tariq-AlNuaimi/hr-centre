-- UX review P0 (docs/blueprints/ux-p0.md, US-6): bell notifications for Hiring
-- and HR tickets. Those hand-offs go to a LOGIN (approvers, panelists, ticket
-- drafters), and many of those users have no employee record, so a
-- notification may now address a User instead of an Employee — exactly one of
-- the two. Existing rows all carry an employee, so the CHECK holds for them.
-- Hand-written: only the changes below (the generator also proposed unrelated
-- drift — hand-maintained constraints and indexes — which must not be dropped).

ALTER TYPE "NotificationKind" ADD VALUE 'HIRING_APPROVAL_REQUESTED';
ALTER TYPE "NotificationKind" ADD VALUE 'HIRING_OFFER_DECIDED';
ALTER TYPE "NotificationKind" ADD VALUE 'HIRING_SCORECARD_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'TICKET_TO_DRAFT';
ALTER TYPE "NotificationKind" ADD VALUE 'TICKET_TO_APPROVE';
ALTER TYPE "NotificationKind" ADD VALUE 'TICKET_RETURNED';

ALTER TABLE "notifications"
  ADD COLUMN "module" VARCHAR(20),
  ADD COLUMN "recipient_user_id" TEXT,
  ALTER COLUMN "recipient_employee_id" DROP NOT NULL;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_one_recipient_check"
  CHECK (("recipient_employee_id" IS NULL) <> ("recipient_user_id" IS NULL));

CREATE INDEX "notifications_recipient_user_id_read_at_idx" ON "notifications"("recipient_user_id", "read_at");
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
