-- AlterTable
-- Nullable column add (no default, no backfill) -- forward-compatible per the
-- migration policy: the running version that doesn't yet read this column is
-- unaffected, and `prisma migrate deploy` applies it on the next build.
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
