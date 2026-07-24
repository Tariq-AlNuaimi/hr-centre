# T11 CSV-import — audit-log proof (D5)

**What this proves:** the Asset CSV import (`POST /api/asset/import`, T11) creates each row
with a **per-row audited `prisma.asset.create` inside one `$transaction`** — so every imported
asset writes its own `CREATE` row in `audit_logs`. It is **NOT** a `createMany` bulk write,
which would bypass the audit + soft-delete extensions (ADR-010 / `no-unaudited-bulk-write`).

**Why this file exists:** the 2026-07-24 challenge-audit found the register claimed T11 was
"proven end-to-end in-browser … both carry CREATE audit_logs rows" but **left no artifact**
(finding D5). This is that artifact — a real run against a live Postgres, not prose.

## Method

- **Live DB:** native Postgres 16 + pgvector (all 7 migrations applied via `prisma migrate deploy`,
  then `prisma:seed`), a throwaway `d5proof` database.
- **Real code under test:** the runner imports the SAME modules the route uses — the audited
  `prisma` client (`@/lib/prisma`, which carries `auditExtension`), `parseCsvToObjects`
  (`@/lib/csv`), and `createAssetSchema` (`@/lib/validations/asset`) — and runs the **identical
  write pattern** from `app/api/asset/import/route.ts:73`:
  `prisma.$transaction(valid.map((data) => prisma.asset.create({ data })))`.
- **Input:** a 2-row CSV whose first row has a **quoted comma** in `name`
  (`"Dell Latitude, 14-inch"`) — the exact edge case the register cites.
- The runner is a throwaway (scratchpad, not committed); it is a thin transcription of the route's
  own body, so re-deriving it is trivial (see "Reproduce" below).

> Fidelity note: run at the service layer, not through the HTTP endpoint, so `userId` is NULL
> (no `withEditorAuth` request context). The invariant under test — **one CREATE audit row per
> imported asset, written by the audit extension on a per-row create** — is exercised exactly;
> the actor field is the only thing a real HTTP request would additionally populate.

## Result (live run, 2026-07-24)

```
=== D5 — CSV-import audit-log proof =====================================
parseCsvToObjects → 2 data rows (row 1 name = "Dell Latitude, 14-inch" — quoted comma preserved)
assets:              3 → 5   (Δ +2)
audit CREATE(Asset): 0 → 2   (Δ +2)

Per-imported-asset CREATE audit_logs rows (the anti-bulk-bypass proof):
  • audit_log cmrzfehap000…  action=CREATE  entityType=Asset  entityId=cmrzfehad000…  assetTag=D5-001  name="Dell Latitude, 14-inch"
  • audit_log cmrzfehap000…  action=CREATE  entityType=Asset  entityId=cmrzfehai000…  assetTag=D5-002  name="ThinkPad X1"

RESULT: PASS — 2 assets imported, 2 CREATE audit_logs rows written (one per row). Per-row audited create, NOT a createMany bulk bypass.
========================================================================
```

Independent raw-SQL confirmation (not via the runner):

```
 assetTag | action | entityType | userId |       after_name       |        timestamp
----------+--------+------------+--------+------------------------+-------------------------
 D5-001   | CREATE | Asset      |        | Dell Latitude, 14-inch | 2026-07-24 21:01:59.185
 D5-002   | CREATE | Asset      |        | ThinkPad X1            | 2026-07-24 21:01:59.185
(2 rows)
```

`SELECT count(*) … WHERE assetTag LIKE 'D5-%' AND action='CREATE'` → **2** (a `createMany` bulk
bypass would show **0** audit rows).

## Reproduce

1. `pg_ctlcluster 16 main start`; create a role+db; `CREATE EXTENSION vector` (superuser).
2. `export DATABASE_URL=…` (Prisma CLI ignores `.env`); `npx prisma migrate deploy`; `npm run prisma:seed`.
3. Transcribe the body of `app/api/asset/import/route.ts` (parse → `createAssetSchema.safeParse`
   each row → `prisma.$transaction(rows.map(r => prisma.asset.create({data:r})))`) using the
   imported `@/lib/*` modules, then query `audit_logs WHERE entityType='Asset' AND action='CREATE'`.
