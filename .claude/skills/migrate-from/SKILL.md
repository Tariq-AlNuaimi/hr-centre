---
name: migrate-from
description: Pull data + schema from a source Postgres database into a freshly scaffolded fork. Claude proposes a column→field mapping, operator reviews, the script dumps + transforms + generates a prisma seed for the target. Use when the user says "migrate from <repo>", "port the staffing module", "move this data", "/migrate-from", or describes carving a feature out of an existing monolith.
---

# /migrate-from — Source DB → fresh fork

Targets the "spin off a feature from a monolith" pattern. Source-schema variance is high; the script handles orchestration, Claude reasons about the column mapping.

## Preconditions

- Target repo is already scaffolded (entities exist via `/scaffold-entity` or `/new-project`).
- Source DB is reachable from the operator's machine (direct, or via SSH tunnel).
- `pg_dump`, `psql` are on PATH.

## Flow

### 1. Inspect source schema

Run `pg_dump --schema-only -t <table>` for each in-scope table. Show the operator the `CREATE TABLE` output.

### 2. Propose column → field mapping

> **IMPORTANT — Restricted-column gate (security).** Before proposing any map,
> scan the source schema for Restricted columns — names matching `password*`,
> `*token*`, `secret`, `api*key`, `salary`, `ssn` (SECURITY.md §1). If any are
> found, **STOP and get explicit written operator approval** (a comment in
> `/tmp/migrate.json` or an inline ack) before proposing the column→field map.
> The script delegates this judgment to you; make the gate explicit and do not
> silently carry a Restricted column across.

Compare source columns to the target Prisma model. Propose a JSON map:

```json
{
  "tables": [
    {
      "source": "employees",
      "target": "Employee",
      "where": "deleted_at IS NULL",
      "columns": {
        "id":            { "to": "id" },
        "full_name":     { "to": "fullName" },
        "email":         { "to": "email" },
        "contract_type": { "to": "contractType", "transform": "upper" },
        "joined_at":     { "to": "joinDate", "transform": "date" },
        "department_id": { "to": "departmentId" }
      }
    },
    {
      "source": "allocations",
      "target": "Allocation",
      "columns": { ... }
    }
  ]
}
```

Available transforms: `upper`, `lower`, `date` (string → `new Date(...)`). Anything richer → the operator hand-edits the generated seed.

**Claude writes the mapping file.** You (Claude) generate `/tmp/migrate.json`
yourself from the source schema + target model — it is not authored by the script
or by hand. Then tell the operator: "Open `/tmp/migrate.json`, edit anything
wrong, then come back."

### 3. Run the dumper

```
npm run migrate-from -- \
  --source-db postgresql://user:pass@source-host:5432/source \
  --target-db postgresql://prisma:pass@target-host:5432/target \
  --map /tmp/migrate.json
```

What it does:

1. Dumps source schema to `/tmp/migrate/schema.sql` (informational; the target's Prisma already owns its schema)
2. `COPY ... TO STDOUT FORMAT csv` for each in-scope table → `/tmp/migrate/<table>.csv`
3. Generates `/tmp/migrate/seed.ts` — a Prisma seed script using the target's own client (so `auditExtension` runs)

### 4. Apply the seed

```
cp /tmp/migrate/seed.ts <target-repo>/prisma/seed.ts
cp /tmp/migrate/*.csv   <target-repo>/prisma/
cd <target-repo>
DATABASE_URL=postgresql://... npm run prisma:seed
```

### 5. Validate

- Row counts: `SELECT count(*)` on source vs. target for each table. **Note:**
  soft-delete filtering hides `deletedAt IS NOT NULL` rows from the default
  `prisma` client, so a count via `prisma` undercounts versus the source. To see
  soft-deleted rows, use `prismaUnfiltered` (or count directly in `psql`).
- Sample 5 random rows per table and diff manually.
- FK integrity: every `Allocation.employeeId` resolves to an `Employee.id`.

The skill prints suggested validation queries; operator runs them.

## Why this is partly manual

The transform layer is project-specific. Even with Claude reasoning, the operator should sanity-check the proposed mapping before any data lands in the target. The script's seed-via-Prisma approach preserves audit + soft-delete invariants automatically.

## Refusal cases

- Map points at a target model that doesn't exist → fix the map or scaffold the model first.
- Source table has columns that map to Restricted fields (per `SECURITY.md` §1) without an audit-trail decision → stop, ask operator to acknowledge in writing (a comment in `/tmp/migrate.json`).

## Read before

- `scripts/migrate-from.mjs`
- `prisma/seed.ts` (target's existing seed pattern)
- `lib/prisma/audit-extension.ts` (so the operator knows what auto-writes)

## Verification

Before calling this done:

- [ ] `/tmp/migrate.json` was written by Claude from the source schema + target
      model, then reviewed/edited by the operator before the dumper ran.
- [ ] Any Restricted-looking source column (`password*`, `*token*`, `secret`,
      `api*key`, `salary`, `ssn`) triggered the explicit written-approval gate
      before it was carried into the map.
- [ ] `npm run migrate-from` completed and produced `/tmp/migrate/seed.ts` plus
      the per-table CSVs.
- [ ] The generated seed was applied against the target `DATABASE_URL`
      (`npx prisma db seed`) and ran without error.
- [ ] Row counts (source vs. target, using `prismaUnfiltered` to account for
      soft-deleted rows), a sampled-row diff, and FK integrity were checked and
      reported to the operator.

**Emits:** a generated Prisma seed (`/tmp/migrate/seed.ts` + per-table CSVs) plus
the reviewed column→field mapping (`/tmp/migrate.json`) the operator signed off
on before any data landed in the target.
