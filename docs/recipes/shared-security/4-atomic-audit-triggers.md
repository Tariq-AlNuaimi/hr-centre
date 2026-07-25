# Recipe: Atomic audit via Postgres triggers

> `/scale-up` → shared-tier security checklist item **#2** (SECURITY.md §16).
> Closes the two gaps **ADR-010** accepted for the prototype rail:
>
> 1. **Non-atomicity** — the app-level audit extension writes the audit row as a
>    _separate statement after_ the data write, so a crash between them loses the
>    audit row.
> 2. **Bulk / upsert blind spot** — `updateMany` / `createMany` / `upsert` on an
>    audited model write **no** audit row at all (the extension only sees per-row
>    `create`/`update`/`delete`).
>
> Postgres triggers fire **per affected row, inside the same transaction as the
> DML**, regardless of how the DML was issued — closing both at once.

> **VERIFIED 2026-07-25 against real Postgres 16** (OPEN-ITEMS item 16). This recipe had never
> been executed — it was 324 lines of unrun PL/pgSQL that forks were told to paste in for
> compliance-grade audit. The SQL below was extracted verbatim, applied to a database carrying
> all template migrations, and exercised with a 12-case battery: single INSERT/UPDATE, scrubbing,
> soft-delete→`DELETE`, restore→`RESTORE`, **multi-row INSERT**, **bulk UPDATE**, **upsert** (the
> three the app-level extension misses), **`ROLLBACK` → zero audit rows** (the atomicity claim),
> and actor-GUC capture. **11/12 passed as written; one real defect was found and is fixed below**
> — a non-resolvable `app.user_id` raised `foreign_key_violation` and took down _the data write
> itself_. Re-verified 12/12 after the fix. Evidence + the battery:
> `docs/verification/atomic-audit-triggers/`.

## When to add it

Add this when the fork is `shared`-tier and carries records that must be
**tamper-evident / provably complete** (financial, compliance, anything where "we
have an audit trail" is a control you'll be asked to prove). For a disposable
prototype, ADR-010's app-level audit is fine — don't add trigger ceremony to a
throwaway.

**This is a significant change with its own ADR** (CLAUDE.md: "move to DB-trigger-based
audit (future ADR)"). Run `/adr` to record it before shipping.

## Deps

None. This is pure SQL in a Prisma migration plus a small change to `withAuth`.

## How it works

- A generic PL/pgSQL trigger function `audit_row_change()` runs `AFTER INSERT OR
UPDATE OR DELETE ... FOR EACH ROW` on every audited table. It writes one
  `audit_logs` row in the **same transaction** as the DML.
- The acting user is read from a **Postgres GUC** (`app.user_id`) that `withAuth`
  sets at the start of each request via `set_config(...)`. No session → `NULL`
  actor (same semantics as today's `withInternalAuth` / cron paths).
- **Scrubbing happens in SQL**: the function strips Restricted keys
  (`passwordHash`, `password`, `mfaSecret`, tokens, secrets, …) from the JSONB
  snapshots before inserting — mirroring `SCRUB_FIELDS` in
  `lib/prisma/audit-extension.ts`.
- The trigger replaces the **app-level** audit + soft-delete audit writes — those
  are **disabled** so you don't get double rows.

## The migration

Create an empty migration and paste the SQL:

```bash
npx prisma migrate dev --create-only --name atomic_audit_triggers
# edit prisma/migrations/<ts>_atomic_audit_triggers/migration.sql with the block below
npx prisma migrate dev   # apply locally
```

```sql
-- prisma/migrations/<ts>_atomic_audit_triggers/migration.sql
-- Atomic, complete audit via per-row triggers (recipe shared-security/4).
-- Writes audit_logs in the SAME transaction as the DML; fires on single-row AND
-- bulk (updateMany/createMany/deleteMany) AND upsert — closing the ADR-010 gaps.

-- 1. Scrub helper: strip Restricted keys from a JSONB snapshot (mirrors
--    SCRUB_FIELDS in lib/prisma/audit-extension.ts — keep the two in lock-step).
CREATE OR REPLACE FUNCTION audit_scrub(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  k text;
  scrub_keys text[] := ARRAY[
    'passwordHash','password','mfaSecret','refresh_token','access_token',
    'id_token','session_state','sessionToken','token','secret','apiKey','api_key'
  ];
BEGIN
  IF payload IS NULL THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY scrub_keys LOOP
    IF payload ? k AND payload -> k IS NOT NULL AND jsonb_typeof(payload -> k) <> 'null' THEN
      payload := jsonb_set(payload, ARRAY[k], '"[redacted]"'::jsonb);
    END IF;
  END LOOP;
  RETURN payload;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. The generic row-level audit trigger function. entityType = the Prisma model
--    name passed as the first trigger argument (PascalCase, to match the existing
--    audit_logs.entityType values written by the app extension).
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS trigger AS $$
DECLARE
  entity_type text := TG_ARGV[0];
  actor       text := NULLIF(current_setting('app.user_id', true), '');
  actor_ip    text := NULLIF(current_setting('app.ip_address', true), '');
  actor_ua    text := NULLIF(current_setting('app.user_agent', true), '');
  before_j    jsonb;
  after_j     jsonb;
  changes_j   jsonb := NULL;
  ent_id      text;
  act         text;
  k           text;
BEGIN
  -- FAIL-OPEN ON ATTRIBUTION (verified 2026-07-25): audit_logs.userId is a FK to users.id.
  -- If app.user_id holds an id with no matching row -- e.g. the actor was PERMANENTLY deleted
  -- via the recycling bin while holding a live JWT, or a fork feeds an SSO subject that is not
  -- a users row -- the trigger's INSERT raises foreign_key_violation and, because the trigger
  -- runs in the caller's transaction, THE DATA WRITE ITSELF FAILS. An audit mechanism must
  -- never take down the application it observes, so an unresolvable actor degrades to NULL
  -- (an unattributed audit row) instead. Costs one PK lookup per audited row.
  IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = actor) THEN
    actor := NULL;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    after_j := audit_scrub(to_jsonb(NEW));
    ent_id  := NEW.id;
    act     := 'CREATE';
  ELSIF (TG_OP = 'UPDATE') THEN
    before_j := audit_scrub(to_jsonb(OLD));
    after_j  := audit_scrub(to_jsonb(NEW));
    ent_id   := NEW.id;
    -- soft-delete / restore detection (matches the app extension's logic)
    IF (to_jsonb(OLD) ->> 'deletedAt') IS NULL AND (to_jsonb(NEW) ->> 'deletedAt') IS NOT NULL THEN
      act := 'DELETE';
    ELSIF (to_jsonb(OLD) ->> 'deletedAt') IS NOT NULL AND (to_jsonb(NEW) ->> 'deletedAt') IS NULL THEN
      act := 'RESTORE';
    ELSE
      act := 'UPDATE';
    END IF;
    -- compute changes (skip updatedAt), scrubbed values for Restricted keys
    changes_j := '{}'::jsonb;
    FOR k IN SELECT jsonb_object_keys(after_j) LOOP
      IF k <> 'updatedAt' AND (before_j -> k) IS DISTINCT FROM (after_j -> k) THEN
        changes_j := changes_j || jsonb_build_object(
          k, jsonb_build_object('from', before_j -> k, 'to', after_j -> k));
      END IF;
    END LOOP;
    IF changes_j = '{}'::jsonb THEN changes_j := NULL; END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    before_j := audit_scrub(to_jsonb(OLD));
    ent_id   := OLD.id;
    act      := 'DELETE';
  END IF;

  INSERT INTO audit_logs (id, "entityType", "entityId", action, before, after, changes,
                          "userId", "ipAddress", "userAgent", timestamp)
  VALUES (
    -- cuid-like fallback id; any unique string is fine for an audit PK.
    gen_random_uuid()::text,
    entity_type, ent_id, act, before_j, after_j, changes_j,
    actor, actor_ip, actor_ua, now()
  );

  RETURN NULL; -- AFTER trigger; return value ignored
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger to each audited table. Pass the PascalCase model name as
--    the arg so entityType matches existing rows. EXCLUDE the auth + audit tables
--    (same set the app extension excludes: AuditLog, Account, Session, VerificationToken).
CREATE TRIGGER audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('User');

-- Add one CREATE TRIGGER per audited table you scaffold, e.g.:
-- CREATE TRIGGER audit_projects
--   AFTER INSERT OR UPDATE OR DELETE ON projects
--   FOR EACH ROW EXECUTE FUNCTION audit_row_change('Project');
```

> `gen_random_uuid()` needs `pgcrypto` (built into modern Postgres 17 / Neon — it's
> a core function there). If a fork's DB lacks it, add
> `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top of the migration.

> **Scaffold integration:** `/scaffold-entity` does not emit this trigger. Until it
> does, **add a `CREATE TRIGGER audit_<table>` line per new audited model** in the
> same migration that creates the table. Make this part of the fork's
> scaffold-review checklist.

## Setting the actor GUC from `withAuth`

The trigger reads `app.user_id` / `app.ip_address` / `app.user_agent` from the
session GUC. Set them per request so the DML in the handler runs with the actor in
scope. `withAuth` already captures `userId` / `ipAddress` / `userAgent` (for the
AsyncLocalStorage `AuditContext`) — reuse them.

Because the template uses the `@prisma/adapter-pg` driver-adapter with a connection
pool, set the GUC **inside a transaction** so it's bound to the same connection as
the writes. Wrap the handler's DB work in an interactive transaction that first sets
the config. The cleanest seam is a small helper the handler calls:

```ts
// lib/audit-guc.ts — run a unit of work with the audit actor bound on the connection.
import { prisma } from "./prisma";
import { getAuditContext } from "./audit-context";

// Use inside a withAuth handler for any write that must be attributed by the DB
// triggers. set_config(..., true) scopes the GUC to THIS transaction only.
export async function withAuditActor<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { userId, ipAddress, userAgent } = getAuditContext();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT
      set_config('app.user_id',    ${userId ?? ""},    true),
      set_config('app.ip_address', ${ipAddress ?? ""}, true),
      set_config('app.user_agent', ${userAgent ?? ""}, true)`;
    return fn(tx);
  });
}
```

Then in a route handler:

```ts
import { withAuth } from "@/lib/api-helpers";
import { withAuditActor } from "@/lib/audit-guc";

export const POST = withAuth(async (req, { session }) => {
  const data = /* zod-validated */;
  const created = await withAuditActor((tx) => tx.project.create({ data }));
  // The trigger wrote the audit_logs row in the SAME tx, attributed to session.user.id.
  return NextResponse.json(created, { status: 201 });
});
```

> `set_config(..., is_local = true)` makes the setting transaction-scoped, so it
> can't leak onto a pooled connection used by another request. The `true` third arg
> is essential with the pg pool. Writes that DON'T go through `withAuditActor` still
> get an audit row — just with a `NULL` actor (same as cron/internal today).

## Disabling the app-level audit

You now have DB triggers AND the Prisma extensions writing audit rows — that's
**double audit**. Disable the app-level writers:

1. **`lib/prisma.ts`** — drop `auditExtension` from the chain:

```ts
function createExtendedClient() {
  const base = createBaseClient();
  // Audit is now done by Postgres triggers (recipe shared-security/4 / ADR-0XX).
  // Keep soft-delete (it rewrites delete→update); the UPDATE trigger records the
  // soft-delete as action:DELETE via the deletedAt transition.
  return base.$extends(softDeleteExtension);
}
```

2. **`lib/prisma/soft-delete-extension.ts`** — it currently calls `recordAudit()`
   for its `delete` / `deleteMany` paths (because it bypasses the audit extension).
   With triggers, the rewritten `update` fires the UPDATE trigger, which sees the
   `deletedAt` NULL→set transition and writes `action:DELETE`. **Remove the
   `recordAudit(...)` calls** from both the `delete` and `deleteMany` handlers (keep
   the soft-delete rewrite itself). Otherwise soft-deletes are double-audited.

3. **Recycling-bin restore / permanent-delete** (which use `prismaUnfiltered` + an
   explicit `recordAudit`) — these now also get a trigger row:
   - **Restore** is an `UPDATE` clearing `deletedAt` → trigger writes `RESTORE`.
   - **Permanent delete** is a real `DELETE` → trigger writes `DELETE`.
     Remove their `recordAudit(...)` calls too. **But** `prismaUnfiltered` runs
     _outside_ `withAuditActor`, so wrap those ops in a `prismaUnfiltered.$transaction`
     that first `set_config`s the actor (same pattern), or accept a `NULL` actor on
     bin operations.

4. **Keep `SCRUB_FIELDS` + the contract test** — `lib/sentry.ts` still imports
   `SCRUB_FIELDS`, and it's the canonical list the SQL `audit_scrub()` mirrors. When
   you add a Restricted key, update **both** the TS set **and** the `scrub_keys`
   array in the migration (note this dual-maintenance in SECURITY.md §5).

## Files to change in a fork

| File                                            | Change                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `prisma/migrations/<ts>_atomic_audit_triggers/` | **New** — the SQL above; **Ask-before** (touches `prisma/migrations`)                   |
| `lib/audit-guc.ts`                              | **New** — `withAuditActor` helper                                                       |
| `lib/prisma.ts`                                 | Drop `auditExtension` from the chain; **Ask-before**                                    |
| `lib/prisma/soft-delete-extension.ts`           | Remove its `recordAudit` calls; **Ask-before**                                          |
| recycling-bin route(s)                          | Remove `recordAudit`; wrap `prismaUnfiltered` ops with the GUC if attribution is wanted |
| write routes                                    | Wrap mutating work in `withAuditActor(...)`                                             |
| `docs/decisions/ADR-0XX-*.md`                   | **New** — run `/adr`                                                                    |
| `SECURITY.md`                                   | Update §5 (atomic; bulk/upsert closed); note dual scrub-list maintenance                |

> Touches `prisma/migrations`, `lib/prisma/*`, and the audit invariant — **Ask
> before** per CLAUDE.md, run `/code-review`, then `/ship`.

## Env vars

None.

## How to test

1. Apply the migration locally (`npm run prisma:migrate`). Insert/update/delete a
   `User` via the app → exactly **one** `audit_logs` row per change (not two — proves
   the app extension is off and the trigger is on).
2. **Atomicity:** in a `psql` session, `BEGIN; UPDATE users SET name='x' WHERE ...;`
   then `ROLLBACK;` → **no** `audit_logs` row remains (the audit row rolled back with
   the DML — impossible with the old separate-statement approach).
3. **Bulk closed:** `UPDATE users SET role='VIEWER' WHERE role='EDITOR';` (multi-row)
   → one `audit_logs` row **per** affected user (the ADR-010 `updateMany` blind spot
   is gone). Same for an `upsert`.
4. **Attribution:** a write through `withAuditActor` records `userId = session.user.id`;
   a raw `psql` write records `NULL` (no GUC set) — both correct.
5. **Scrub:** update a user's password → `audit_logs.after->>'passwordHash'` is
   `"[redacted]"`.
6. `npm test` (the `scrub`/`computeChanges` contract still passes — those exports
   remain) and `/ship`.

## Rollback

```sql
DROP TRIGGER IF EXISTS audit_users ON users;
-- ...drop each audit_<table> trigger...
DROP FUNCTION IF EXISTS audit_row_change();
DROP FUNCTION IF EXISTS audit_scrub(jsonb);
```

(as a new `prisma migrate` down-migration), then:

1. Re-add `auditExtension` to the chain in `lib/prisma.ts`.
2. Restore the `recordAudit` calls in `soft-delete-extension.ts` + the bin routes.
3. Delete `lib/audit-guc.ts` and revert the handlers.

> Known trap: `vercel.json` runs `prisma migrate deploy` every build. Sequence the
> rollback so the running code matches the trigger state at each step (turn the
> extension back on in the same deploy that drops the triggers, or you briefly get
> zero OR double audit).

## SECURITY.md rows to update

**§5** — replace the "Non-atomicity (accepted limitation)" and "Bulk-write / upsert
blind spot" paragraphs with: "Audit is written by Postgres `AFTER ... FOR EACH ROW`
triggers in the same transaction as the DML (recipe shared-security/4 / ADR-0XX) —
atomic, and complete across single-row, bulk (`updateMany`/`createMany`/`deleteMany`),
and `upsert` writes. Restricted-field scrubbing is done in SQL by `audit_scrub()`,
which mirrors `SCRUB_FIELDS` — **keep both in lock-step when adding a Restricted key.**"

**§11 / §16 row 2** — flip the atomic-audit item to done, referencing this recipe +
the new ADR.
