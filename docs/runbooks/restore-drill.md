# Runbook — Backup restore drill

**Purpose:** prove the database can actually be restored from a backup **before**
an incident forces it. An untested backup is a hope, not a control. Run this on
the review cadence (quarterly) and after any change to the backup tooling or the
schema-migration convention. Decision of record: **ADR-055**.

> **The rule:** a restore is not "verified" because a backup job exited green.
> It is verified when a backup has been restored into a throwaway target and its
> data + `/api/health` checked. Log every drill in the table at the bottom.

## Which backup source am I restoring from?

| Deploy rail                                    | Backup mechanism                                                                                          | Restore primitive                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Vercel + Neon (default, ADR-006)**           | Neon automatic backups + **PITR** (point-in-time restore); Neon **branches** are instant zero-copy clones | Neon Console → _Restore_ / _Branch_ to a timestamp, or `neonctl` |
| **Self-host Postgres (Docker/Caddy, ADR-035)** | **WAL-G** base backups + WAL archiving (the self-host backup tool; C02 lane), or scheduled `pg_dump`      | `wal-g backup-fetch` + WAL replay, or `pg_restore`               |

Never restore a drill _over_ production. Always restore into a **throwaway
target** (a Neon branch, or a scratch Postgres container) and compare against
production read-only.

---

## Drill A — Neon (default rail)

Prereqs: Neon project access (Console or `neonctl auth`); the production
`DATABASE_URL`; a scratch shell with `psql` + `npx prisma`.

1. **Record the "known-good" baseline** from production (read-only):
   - `psql "$DATABASE_URL" -c "select count(*) from users;"` — note the count.
   - Pick a stable sentinel row (e.g. the seeded admin user) and note a field.
   - `curl -fsS https://<prod-url>/api/health` → expect `{"status":"ok"}`.
2. **Create a restore target from a backup, NOT from live:**
   - Console → your project → **Branches → New branch** → _Include data up to_ a
     timestamp ~1 hour in the past (this exercises PITR, not a live copy), OR
   - Console → **Restore** to a past timestamp into a new branch.
   - Copy the branch's connection string → `RESTORE_URL`.
3. **Verify the restored data** against the baseline:
   - `psql "$RESTORE_URL" -c "select count(*) from users;"` — expect the count to
     match the baseline (allowing for writes after the chosen timestamp).
   - Confirm the sentinel row is present and correct.
4. **Verify the app runs against the restore** (schema + client are intact):
   - `DATABASE_URL="$RESTORE_URL" npx prisma migrate status` → expect
     _Database schema is up to date_ (no pending/failed migrations).
   - Optionally point a local app at it: `DATABASE_URL="$RESTORE_URL" npm run dev`
     then `curl -fsS localhost:3000/api/health` → `{"status":"ok"}`.
5. **Measure & record** the wall-clock time from step 2 to a green step 4 — this
   is your **RTO** (recovery time objective) evidence.
6. **Tear down** the throwaway branch (Console → delete branch) so it does not
   accrue cost or get mistaken for prod.
7. **Log the drill** in the table below (date, source timestamp, RTO, result).

---

## Drill B — Self-host Postgres (WAL-G / pg_dump)

Prereqs: access to the WAL-G archive + its env (`WALG_*` / object-store creds),
or a `pg_dump` artifact; Docker.

1. **Baseline** from production (read-only): row count of `users`, a sentinel
   row, and `curl -fsS https://<host>/api/health`.
2. **Stand up a scratch Postgres** to restore into (never the prod container):
   `docker run --rm -d --name restore-drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:17`
3. **Restore the backup into the scratch instance:**
   - WAL-G: fetch the latest base backup into the scratch data dir and replay WAL
     to a target time — `wal-g backup-fetch <datadir> LATEST` then configure
     `recovery_target_time` and start Postgres (follow your WAL-G deployment's
     documented fetch command; it is environment-specific).
   - `pg_dump` artifact: `pg_restore -d "postgres://postgres:drill@localhost:55432/app" --clean --if-exists <dump-file>`.
4. **Verify data** against the baseline (row count + sentinel), same as Drill A.
5. **Verify schema/app:** `DATABASE_URL="postgres://postgres:drill@localhost:55432/app" npx prisma migrate status` → up to date; optionally run the app against it and hit `/api/health`.
6. **Measure RTO** (step 2 → green step 5) and **tear down**:
   `docker rm -f restore-drill`.
7. **Log the drill** below.

---

## Pass criteria (all must hold)

- [ ] The restore came from a **backup/PITR**, not a live copy of production.
- [ ] Restored `users` count matches the baseline (within expected drift).
- [ ] The sentinel row is present and correct.
- [ ] `npx prisma migrate status` reports the schema up to date on the restore.
- [ ] `/api/health` returns `{"status":"ok"}` against the restored DB.
- [ ] RTO was measured and is within the tenant's tolerance.
- [ ] The throwaway target was torn down.

Any unchecked box = **drill FAILED** → this is an incident-in-waiting. Fix the
backup/restore path and log a finding in `docs/findings-register.md`
(`[scalable]`/`[quality]` — an unrestorable backup is an open operational risk)
before claiming operational readiness at `/handoff`.

## Drill log

| Date       | Rail | Backup source (timestamp) | RTO | Result | Notes                                                                                          |
| ---------- | ---- | ------------------------- | --- | ------ | ---------------------------------------------------------------------------------------------- |
| 2026-07-11 | —    | (template — no live DB)   | —   | N/A    | Starter template ships no deployed DB; first real drill runs on the first fork's first deploy. |

> **`/handoff` gate:** a handoff that claims operational readiness requires the
> most recent row to be **PASS** and dated within the review cadence
> (quarterly). A stale or never-run drill is not "ready."
