# Verification — atomic audit via Postgres triggers (OPEN-ITEMS item 16)

**What this is.** `docs/recipes/shared-security/4-atomic-audit-triggers.md` is the recipe a
`shared`-tier fork applies when it needs tamper-evident, provably-complete audit — closing the two
gaps ADR-010 knowingly accepted for the prototype rail (non-atomicity, and the
`updateMany`/`createMany`/`upsert` blind spot).

**Why it needed doing.** The recipe had **never been executed**. No test, no migration, no
evidence referenced `audit_row_change` anywhere in the repo — 324 lines of unrun PL/pgSQL that a
fork was told to paste into production for a control it would be asked to _prove_. That is the
same "prose asserting verification" pattern the 2026-07-24 challenge-audit kept finding, and on a
compliance surface it is the worst place for it.

**What was NOT done, deliberately.** The triggers were **not** made the template default. ADR-010
accepts app-level audit for the prototype rail, the recipe itself says _"for a disposable
prototype … don't add trigger ceremony to a throwaway"_, and the template ships `tier: personal`.
Turning this on by default would change the data layer for every fork and require disabling the
audit extension. Item 16's real value was making the opt-in path **trustworthy**, not forcing it.

## Method

1. Clean database, all template migrations applied (`prisma migrate deploy`).
2. The recipe's first `sql` block extracted **verbatim** (no hand-editing — testing exactly
   what a fork pastes) and applied.
3. `trigger-battery.sql` (beside this file) run against it — 12 assertions, each printing PASS/FAIL.

## Result — 11/12 as written; 12/12 after the fix

| #   | Assertion                                               | As written | Fixed |
| --- | ------------------------------------------------------- | ---------- | ----- |
| T1  | single INSERT → 1 `CREATE` row                          | PASS       | PASS  |
| T2  | `passwordHash` scrubbed to `[redacted]`                 | PASS       | PASS  |
| T3  | UPDATE → 1 `UPDATE` row with a `changes` diff           | PASS       | PASS  |
| T4  | soft-delete (`deletedAt` set) → `DELETE` action         | PASS       | PASS  |
| T5  | restore (`deletedAt` cleared) → `RESTORE` action        | PASS       | PASS  |
| T6a | **multi-row INSERT (`createMany`) → 3 rows**            | PASS       | PASS  |
| T6b | **bulk UPDATE (`updateMany`) → 3 rows**                 | PASS       | PASS  |
| T7  | **upsert (`ON CONFLICT`) → 1 row**                      | PASS       | PASS  |
| T8  | **`ROLLBACK` → 0 audit rows (atomicity)**               | PASS       | PASS  |
| T8b | rolled-back row genuinely absent                        | PASS       | PASS  |
| T9  | actor GUC → `userId` + `ipAddress` captured             | PASS       | PASS  |
| T10 | **stale/unresolvable actor GUC must not break the DML** | **FAIL**   | PASS  |

T6a/T6b/T7 are the cases the app-level extension **cannot** cover, and T8 is the headline
atomicity claim — all confirmed against a real database rather than asserted.

## The defect found (T10) — and the fix

`audit_logs.userId` is a foreign key to `users.id`. The trigger inserted
`current_setting('app.user_id')` into it unconditionally. If that GUC held an id with no matching
row, the trigger's INSERT raised `foreign_key_violation` — and because the trigger runs **inside
the caller's transaction**, _the data write itself failed_.

Reachable in production: an actor **permanently deleted** through the recycling bin while holding
a live JWT, or a fork feeding an SSO subject that isn't a `users` row. The audit mechanism would
then take down ordinary writes for that user.

**Fix (now in the recipe):** resolve the actor first and degrade to `NULL` when it doesn't exist —

```sql
IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = actor) THEN
  actor := NULL;
END IF;
```

Fail-open on _attribution_, never on the write. Confirmed the degraded path still writes the audit
row, just unattributed (`actor = <NULL actor>`) — the event is never lost, only its author.
Cost is one PK lookup per audited row.

## Not a defect (checked)

The pooled-connection hazard is already handled correctly: the recipe's `withAuditActor` helper
uses `set_config(..., true)` (**transaction**-scoped) and explicitly warns that the `true` is
essential with the pg pool, so a GUC cannot leak onto another request's connection.

## Reproduce

````bash
createdb trigaudit && DATABASE_URL=… npx prisma migrate deploy
# extract the recipe's first ```sql``` block, apply it, then:
psql -d trigaudit -f docs/verification/atomic-audit-triggers/trigger-battery.sql
````

Note the battery deletes `users` **before** clearing `audit_logs` — the reverse order lets
trigger-written DELETE rows from a previous run pollute the counts (that bit me once).
