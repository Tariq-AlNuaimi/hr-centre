# Rollback note — ADR-070, and what a revert does not undo

**Written before it is needed, on purpose.** The one migration in this change is not reversible by
`git revert`, and the moment to learn that is not during an incident.

**Scope:** the ADR-070 series — `d1662ee` (#27), `4655e88` (#28), `15f404d` (#29), `725cbde` (#30).
Only the last carries a database migration.

---

## The short version

| Commit                                                   | Revert restores it?    | Notes              |
| -------------------------------------------------------- | ---------------------- | ------------------ |
| `d1662ee` #27 — the access screen, boolean platform role | **Yes, fully**         | Code only          |
| `4655e88` #28 — breadth-review fixes, docs               | **Yes, fully**         | Code and docs only |
| `15f404d` #29 — SSO seam narrowed                        | **Yes, fully**         | Code only          |
| `725cbde` #30 — `EDITOR` retired from the enum           | **Code yes. Data no.** | See below          |

---

## What the migration did, and why it is one-way

`prisma/migrations/20260827090000_pms_retire_editor_role` does two things, in one transaction:

1. `UPDATE "users" SET "role" = 'VIEWER' WHERE "role" = 'EDITOR'`
2. Swaps the `Role` enum type for a two-value version (`ADMIN`, `VIEWER`)

Postgres cannot drop a value from an enum, so the type is replaced — and the replacement's `USING`
cast **fails** on any row still holding `'EDITOR'`, which is exactly why the backfill runs first.

**Reverting the code does not run anything backwards.** After a revert:

- The enum still has two values. Prisma's client would be regenerated with three, and any attempt to
  write `EDITOR` would fail at the database with an invalid-input-value error.
- Any row that held `EDITOR` now holds `VIEWER`, and there is no record of which ones. The
  information is gone, not hidden.

## Why that is safe anyway

**`EDITOR` granted nothing.** `withEditorAuth` — the only wrapper that admitted it — was never called
by a single route in this application. Every authorization read of `User.role` in the product is
`=== "ADMIN"`. So a row that moved from `EDITOR` to `VIEWER` lost no permission; it stopped claiming
one it never had.

That is a checkable claim, not an assertion: `tests/contracts/api-auth.test.ts` asserts that
`withAdminAuth` refuses an `EDITOR` session, and `tests/eslint-rules/rules.test.mjs` asserts that
`no-bare-api-route` now treats a handler wrapped in `withEditorAuth` as **bare**.

## If you genuinely need `EDITOR` back

Do **not** try to revert the migration. Write a new forward one:

1. `ALTER TYPE "Role" ADD VALUE 'EDITOR';` — additive, non-breaking, no type swap needed.
2. Put the value back in `prisma/schema.prisma` and regenerate.
3. Re-add `withEditorAuth`'s couplings **with its first real caller in the same commit** — the
   scaffolder's `--writes editor`, `scripts/rbac-matrix.mjs`, and the two ESLint rules' wrapper
   lists. Re-adding the wrapper without a caller recreates the exact problem ADR-070 removed: dead
   authority that reads as live.
4. The rows that were backfilled cannot be identified after the fact. Anyone who should be `EDITOR`
   has to be set again by hand.

**Before doing any of that**, be sure the answer isn't `ADMIN`. ADR-070's finding was that this
product has two states of platform authority, not three, and the middle one was decorative.

## Rolling back the code alone

If the _screens_ need to go back but the enum is fine where it is:

```bash
git revert -m 1 725cbde   # …and the earlier merges as needed
```

Then regenerate the Prisma client so the schema and the database agree — otherwise the client
believes in a value the database will reject. Check `prisma/schema.prisma` still declares two values
before deploying; a reverted schema file is the trap here.

## The faster option

On the Vercel rail, **"Promote to Production" on the prior deployment** puts the old code back in
about a minute without touching git. The database is unchanged either way, so the same caveat
applies: old code, new enum.
