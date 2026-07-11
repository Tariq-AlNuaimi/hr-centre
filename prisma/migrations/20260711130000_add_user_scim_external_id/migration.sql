-- Stable directory id for SCIM correlation (ADR-045 amendment A3, WS-6 closeout).
--
-- Forward-compatible + additive: a NULLABLE column + a unique index, no default
-- and no backfill. Existing rows (and every password/non-SCIM user) stay NULL;
-- Postgres permits multiple NULLs under a unique index, so no collision. The
-- running app version does not read the column until the code that references it
-- deploys, so `prisma migrate deploy` (vercel.json runs it every build) is safe.
--
-- Purpose: lib/sso/scim.ts now correlates a dsync event on this stable directory
-- id first (falling back to email), so a directory email-RENAME updates the
-- existing row in place instead of orphaning access with a second row (US-3).

ALTER TABLE "users" ADD COLUMN "scim_external_id" TEXT;

CREATE UNIQUE INDEX "users_scim_external_id_key" ON "users"("scim_external_id");
