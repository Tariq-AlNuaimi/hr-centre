-- UX P1 (tickets P1-2, P1-4): ticket assignee, internal answer-by time,
-- first response, the response-hours setting, and saved replies. prisma
-- migrate drift noise (hand-written composite FKs, trigram indexes) omitted.

-- AlterTable
ALTER TABLE "hive_escalations" ADD COLUMN     "assignee_id" TEXT,
ADD COLUMN     "due_at" TIMESTAMP(3),
ADD COLUMN     "first_response_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "hive_ticket_settings" ADD COLUMN     "response_hours" INTEGER NOT NULL DEFAULT 16;

-- CreateTable
CREATE TABLE "hive_saved_replies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hr_pair_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hive_saved_replies_hr_pair_id_idx" ON "hive_saved_replies"("hr_pair_id");

-- CreateIndex
CREATE INDEX "hive_saved_replies_created_by_id_idx" ON "hive_saved_replies"("created_by_id");

-- CreateIndex
CREATE INDEX "hive_escalations_assignee_id_status_idx" ON "hive_escalations"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "hive_escalations_due_at_idx" ON "hive_escalations"("due_at");

-- AddForeignKey
ALTER TABLE "hive_escalations" ADD CONSTRAINT "hive_escalations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_saved_replies" ADD CONSTRAINT "hive_saved_replies_hr_pair_id_fkey" FOREIGN KEY ("hr_pair_id") REFERENCES "hive_hr_tag_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_saved_replies" ADD CONSTRAINT "hive_saved_replies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
