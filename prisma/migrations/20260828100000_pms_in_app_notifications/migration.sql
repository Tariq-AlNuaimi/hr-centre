-- In-app notifications — the second channel for §5.5's escalation ladder.
--
-- Purely additive: one enum, one table, three indexes. Nothing existing is
-- altered, so a running deployment on the previous version is unaffected
-- (`vercel.json` runs `prisma migrate deploy` on every build, before the new
-- code is live — see docs/rules/prisma.md).

CREATE TYPE "NotificationKind" AS ENUM ('CYCLE_REMINDER', 'CYCLE_ESCALATION', 'HR_INTERVENTION', 'THREE_SIXTY_REMINDER');

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_employee_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. A daily sweep re-deriving the same unresolved miss
-- collides here and is discarded; HR extending the deadline changes the key and
-- a fresh notification is written.
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- The unread badge counts on the first; the feed pages on the second.
CREATE INDEX "notifications_recipient_employee_id_read_at_idx" ON "notifications"("recipient_employee_id", "read_at");
CREATE INDEX "notifications_recipient_employee_id_created_at_idx" ON "notifications"("recipient_employee_id", "created_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_employee_id_fkey" FOREIGN KEY ("recipient_employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
