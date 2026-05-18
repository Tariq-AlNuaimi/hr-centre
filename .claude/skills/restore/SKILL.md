---
name: restore
description: Pull a backup dump from the off-host rclone remote, decrypt with BACKUP_AGE_IDENTITY, restore into a NEW Postgres container. Executes via the `restore.yml` GitHub Actions workflow (ADR-004). Never the live one. Use when the user says "restore from backup", "test a backup", "investigate yesterday's data", "/restore".
---

# /restore — CI-driven restore into ephemeral Postgres

For **inspection** and **disaster-recovery drills**, not blind in-place
restoration. Live-stack swap is intentionally manual.

> **Executes via GH Actions workflow.** Claude composes inputs; operator
> dispatches `restore.yml`. The workflow installs rclone + age + psql,
> materializes `RCLONE_CONFIG` and `BACKUP_AGE_IDENTITY` from secrets, runs
> the restore script inside the runner. See ADR-004.

## Claude's job

1. Ask the operator which env + which dump (default `latest`).
2. Compose the workflow trigger.
3. Tail and report.

## Inputs

| Input | Default | Notes |
|---|---|---|
| `env` | required | `staging` or `prod` |
| `slug` | `package.json` name | kebab-case |
| `dump_name` | `latest` | or a specific filename, e.g. `2026-05-15.dump.age` |

## Trigger command Claude composes

```sh
gh workflow run restore.yml \
  -f env=prod \
  -f slug=acme-portal \
  -f dump_name=latest
```

## What the workflow does

1. Restores `.deploy-state.<env>.json` from the state branch (for slug /
   bucket lookup).
2. Installs `rclone`, `age`, and `postgresql-client` in the runner.
3. Writes `RCLONE_CONFIG` (repo secret) to `~/.config/rclone/rclone.conf`
   and `BACKUP_AGE_IDENTITY` (repo secret) to
   `/opt/backup/keys/<env>.identity`.
4. Runs `scripts/restore.mjs --env <env> --pick <dump_name>`:
   - `rclone lsf` → find dumps; pick `latest` or the specified filename.
   - `rclone copyto` → `/tmp/restore-<env>-<ts>.dump.age`.
   - `age -d -i <identity>` → plaintext.
   - `docker run -d postgres:17-alpine` on port 5433.
   - `pg_restore --no-owner --no-privileges`.
   - `SELECT count(*) FROM users` sanity check.
5. Masks the resulting `postgresql://...` connection string in any
   subsequent log output via `::add-mask::`. The connection string is still
   printed once for the operator (they need it to inspect the DB), but the
   workflow ensures it doesn't get re-emitted by downstream steps.

## Refusal cases

- `BACKUP_AGE_IDENTITY` or `RCLONE_CONFIG` not set as repo secrets → restore
  step fails. Set them via `/first-fork`.
- No `.dump.age` files on remote → script bails with "no backups; check
  backup.sh sidecar".

## Hot-swap into live (deliberately not automated)

If the restored DB looks right and you want to swap it into live, this is
a manual runbook:
1. Inspect schema parity in the restored DB vs. live.
2. Stop the app container in Portainer.
3. Edit the stack's `DATABASE_URL`.
4. Restart the stack.

Get explicit operator approval before each step. This is irreversible.

## Concurrency

`concurrency: { group: restore-<env>, cancel-in-progress: false }`.

## Read before
- `.github/workflows/restore.yml`
- `scripts/restore.mjs`
- `deploy/backup.sh` (the encryption format being decrypted)
- SECURITY.md §4
- ADR-004
