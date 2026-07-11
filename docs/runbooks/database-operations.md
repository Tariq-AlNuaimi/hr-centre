# Runbook — Database operations

**Purpose:** run migrations, touch data, and handle connection pressure **safely**
on this template's Prisma 7 + Postgres stack, where migrations apply
automatically on every build/start. Decision of record: **ADR-055**. Anything
under `lib/prisma/` or `prisma/migrations/` is an **Ask-before** change
(CLAUDE.md) — this runbook is the operational half of those rules.

## The one rule that governs everything here

`vercel.json`'s `buildCommand` runs `prisma migrate deploy` on **every** build,
and the self-host image runs migrations at container **start**. There is no
manual "apply migration" step in production and **no gate between your migration
and prod** other than review. Therefore:

> **Every migration must be forward- AND backward-compatible across one deploy.**
> Both the old and the new app version must run against the new schema, because
> during a rolling deploy (and during any rollback) they do. This is
> **expand / contract** by convention.

## Safe migration checklist (expand / contract)

**Expand (safe, additive — do these freely):**

- [ ] Add a **nullable** column, or a column **with a default** (not a required
      column with no default onto a populated table — that fails or locks).
- [ ] Add a new table / index (`CREATE INDEX CONCURRENTLY` for large tables to
      avoid a write lock — Prisma raw migration if needed).
- [ ] Backfill data in a **separate, later** migration or a batched job, never
      inline in the schema migration.

**Contract (dangerous — never in the same deploy as the code that stops using
the column):**

- [ ] **Do not drop or rename** a column/table the currently-running version
      still reads. Renames are a drop+add to Postgres — split into: (1) add new,
      (2) dual-write/backfill, (3) switch reads, (4) _later deploy_ drops old.
- [ ] **Do not narrow** a type or add a `NOT NULL`/unique constraint that
      existing rows or the old code violate, in the same deploy.

**Every migration:**

- [ ] Is **small** (one concern) — `vercel.json` re-runs `migrate deploy` on
      every build; a big/slow migration extends every deploy and every rollback.
- [ ] Was generated via `npm run prisma:migrate` (dev) → committed under
      `prisma/migrations/`; never hand-edit an already-applied migration.
- [ ] Goes through Prisma — **no raw SQL** except `$queryRaw`/`$executeRaw` with
      parameter placeholders; never `$executeRawUnsafe` on user input; no
      `SELECT *`; no raw `UPDATE`/`DELETE` without `WHERE` (CLAUDE.md hard rule,
      enforced by `no-raw-sql-unsafe`).
- [ ] Adding a **Restricted** column? Extend `SCRUB_FIELDS` in
      `lib/prisma/audit-extension.ts` **and** its assertion in
      `tests/contracts/audit-scrub.test.ts` in the **same commit**, and never
      add it as a `toExcel` export column (`no-restricted-export-column`).

Check state anytime: `npx prisma migrate status` (→ _up to date_ / lists
pending/failed). A **failed** migration in prod blocks all subsequent deploys
until resolved — treat as SEV-2 (`incident-response.md`).

## Two Prisma clients — know which you're using

- **`prisma`** (default, `lib/prisma/client.ts`) — carries the **audit** +
  **soft-delete** extensions. Every route and service uses this. Soft-deletes go
  to the recycling bin, not gone.
- **`prismaUnfiltered`** — **bypasses** soft-delete _and_ audit. Allowlisted to
  auth / recycling-bin / maintenance / health only (`no-prisma-unfiltered-import`
  gates ordinary routes). Using it in a normal path is an **Ask-before** change:
  a write through it leaves **no audit trail**, and a read through it returns
  **soft-deleted rows**. When operating manually, prefer `prisma` unless you
  specifically need to see/purge soft-deleted data.

## Recycling-bin caveats (soft delete)

- A "delete" from the UI is a **soft delete** — the row is flagged, hidden from
  normal reads, and lands in the **recycling bin** (`/recycling-bin` page;
  `GET/DELETE /api/recycling-bin/...`). It is **not gone from the database**.
- **Restore:** via the recycling-bin UI/route (un-sets the soft-delete flag).
- **Permanent delete:** either from the recycling bin, or automatically by the
  daily purge — records soft-deleted past `RECYCLE_BIN_RETENTION_DAYS`
  (default 90) are hard-deleted by `app/api/internal/audit-purge`, each with an
  explicit DELETE audit row so purged PII does not linger.
- **Operational gotcha:** "I deleted it but the count/space didn't drop" is
  expected — soft-deleted rows occupy storage until the retention purge. To free
  space sooner, permanently delete from the bin. Don't reach for
  `prismaUnfiltered` raw deletes to "clean up" — that skips audit.
- The audit-purge itself is bounded and **batched** (a first activation on a
  long-lived fork can face a large backlog; batches commit incrementally so a
  timeout resumes next run). It is `CRON_SECRET`/`AUDIT_PURGE_TOKEN`-gated and a
  silent no-op until those are set (ADR-018).

## Connection exhaustion (the most common DB incident)

Symptom: `/api/health` flips to `503 degraded`, or routes error with
`too many connections` / `Can't reach database server` / pool timeouts.

**Why it happens on this stack:** serverless functions (Vercel) each open DB
connections; under load or with a small Postgres `max_connections`, the pool is
exhausted. Neon's connection limit is plan-dependent.

**First response:**

1. Confirm with `/api/health` and the provider dashboard (Neon → _Monitoring_ →
   active connections vs limit; or `psql -c "select count(*) from pg_stat_activity;"`).
2. **Use the pooled connection string.** Neon provides a **pooler** endpoint
   (PgBouncer) — `DATABASE_URL` should point at the **-pooler** host for the
   serverless app, not the direct endpoint. A direct endpoint under serverless
   load is the classic cause. (Prisma migrations need the **direct** URL — keep
   that split correct.)
3. **Shed load:** the offending route(s) should be rate-limited
   (`withRateLimit` OUTSIDE the auth wrapper); confirm limits engage. A single
   unbounded/`N+1` query path can exhaust the pool alone — find it (list/read
   routes must paginate/bound; bulk paths must not be N×1) and bound it.
4. **Scale the ceiling** if genuinely at capacity: bump the Neon plan/pooler
   settings; for multi-instance rate-limit correctness move to Upstash via
   `/scale-up`. The in-memory limiter is per-instance by design.

**Prevent:** every list/read route paginates or bounds its result set; no N+1
(the Scalable pillar — `/ship`'s unbounded-query scan is the automatable slice);
pooled URL for the app, direct URL for migrations.

## Manual data touch (rare — prefer a migration or a route)

If you must operate on prod data directly (last resort):

- Read-only investigation: `psql "$DATABASE_URL"` with `SELECT` — fine.
- **Any write:** prefer a reviewed migration or an authed route so it goes
  through audit + validation. If you truly must run a manual write, do it
  parameterized, `WHERE`-scoped, and **record it** (it bypasses `auditExtension`
  — note who/what/when in the incident log or `docs/findings-register.md`).
- **Take a backup / Neon branch first** (`restore-drill.md` shows the branch
  move) so the operation is reversible.
