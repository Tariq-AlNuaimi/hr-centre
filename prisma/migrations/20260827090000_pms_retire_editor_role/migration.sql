-- Retire `EDITOR` from the platform `Role` enum — ADR-070.
--
-- WHAT EDITOR ACTUALLY DID. Nothing. `withEditorAuth` was defined in
-- lib/api-helpers.ts and never called by a single route in this application;
-- every read of `User.role` in the product is `=== "ADMIN"`. So the value was a
-- rung on a ladder that did not exist — a stored privilege the product does not
-- honour, which is worse than a missing one: the first teaches something false
-- to whoever reads the row next.
--
-- ADR-070 closed the grant paths in two steps before touching the data. First the
-- zod boundary (`lib/validations/user.ts` takes a boolean and refuses a `role`
-- key outright), then the SSO seam (`mapSsoRole` no longer reads
-- SSO_EDITOR_GROUPS — JIT provisioning bypasses zod entirely, so the boundary
-- narrowing had not reached it). This migration is the last step: with nothing
-- able to WRITE the value, the value itself goes.
--
-- ORDER IS THE WHOLE POINT OF HAND-WRITING THIS. Postgres cannot drop a value
-- from an enum, so the type is swapped — and the swap's `USING` cast FAILS on any
-- row still holding 'EDITOR'. Prisma's generated migration would emit the swap
-- alone and abort mid-deploy against a database that has one. The backfill
-- therefore runs FIRST, in the same transaction, so either both happen or
-- neither does.
--
-- The backfill is NOT data loss. `EDITOR` and `VIEWER` granted exactly the same
-- nothing, so a row moving between them changes no permission — it stops
-- claiming one it never had. That claim is checkable rather than asserted: the
-- ADMIN-vs-not property is pinned by `withAdminAuth returns 403 for an EDITOR
-- session` in tests/contracts/api-auth.test.ts.
--
-- The write is silent by design: the audit trail records decisions people make,
-- and this is a schema correction applied by a migration, not an actor demoting
-- anyone. The reason lives here, in git, permanently.

-- 1. Backfill first, so the cast below cannot fail.
UPDATE "users" SET "role" = 'VIEWER' WHERE "role" = 'EDITOR';

-- 2. Swap the type. `role` is the ONLY column of type "Role" in the schema
--    (employees.pmsRoles is PmsRole[], a different enum by ADR-065), so this is
--    the complete set of dependents.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- The default is dropped and re-added around the retype: Postgres will not cast
-- a column whose DEFAULT still references the old type.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

DROP TYPE "Role_old";
