-- CreateTable
CREATE TABLE "jml_preboarding" (
    "case_id" TEXT NOT NULL,
    "link_issued_at" TIMESTAMP(3),
    "link_expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "photo_pathname" TEXT,
    "photo_content_type" TEXT,
    "photo_uploaded_at" TIMESTAMP(3),
    "documents" JSONB NOT NULL DEFAULT '{}',
    "last_reminder_at" TIMESTAMP(3),
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jml_preboarding_pkey" PRIMARY KEY ("case_id")
);

-- CreateIndex
CREATE INDEX "jml_preboarding_submitted_at_link_expires_at_idx" ON "jml_preboarding"("submitted_at", "link_expires_at");

-- AddForeignKey
ALTER TABLE "jml_preboarding" ADD CONSTRAINT "jml_preboarding_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "jml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
