---
name: restore
description: Pull a backup dump from the off-host rclone remote, decrypt with BACKUP_AGE_IDENTITY, restore into a NEW Postgres container (never live). Use when the user says "restore from backup", "test a backup", "investigate yesterday's data", "/restore", or wants to verify a backup is good. Hot-swap into live is intentionally manual (runbook, not one flag).
---

# /restore — Backup → ephemeral Postgres

This skill is for **inspection** and **disaster-recovery drills**, not blind in-place restoration. Live-stack swap requires manual edit of the Portainer stack — by design.

## Preconditions

- `rclone`, `age`, `docker`, `psql` on PATH.
- `BACKUP_AGE_IDENTITY` (the private key) is at a path the operator knows; default lookup is `/opt/backup/keys/<env>.identity` on the host.
- The backup pipeline (`deploy/backup.sh` sidecar) has produced at least one dump.

## Inputs

| Flag | Default |
|---|---|
| `--env` | `prod` |
| `--pick` | `latest` (most recent on remote) or a specific filename |
| `--into-port` | `5433` (so it doesn't clash with a local Postgres) |
| `--age-identity-path` | `/opt/backup/keys/<env>.identity` |

## Steps

1. `rclone lsf <remote>:<bucket>` to list dumps.
2. `rclone copyto <remote>:<bucket>/<pick>` → `/tmp/restore-<env>-<ts>.dump.age`.
3. `age -d -i <identity>` → `.dump` plaintext.
4. `docker run -d postgres:17-alpine` on port `5433` (or `--into-port`).
5. `pg_restore --no-owner --no-privileges` into the ephemeral DB.
6. Validate: `SELECT count(*) FROM users` (sanity check that the dump wasn't empty).

## Usage

```
npm run restore -- --env prod --pick latest
# or
npm run restore -- --env prod --pick 2026-05-15.dump.age
```

## What it prints at the end

- Connection string of the ephemeral DB (`postgresql://restore:restore@127.0.0.1:5433/restore`)
- Container name (for cleanup: `docker rm -f <name>`)
- A warning that hot-swap into the live stack is manual (`.env` edit + Portainer redeploy)

## Refusal cases

- `BACKUP_AGE_IDENTITY` not found → fail with the expected path.
- No `.dump.age` files on remote → fail with "no backups, check that backup.sh sidecar is running".

## Hot-swap procedure (deliberately not automated)

If the restored DB looks right and you want to swap it into live:
1. Inspect schema parity: `\d users` in the restored DB vs. the live one. Migration history must match.
2. Stop the app container: Portainer → stack → containers → stop `app`.
3. Edit the stack's `DATABASE_URL` to point at the restored DB (host + port).
4. Restart the stack.

**Get explicit operator approval before each step.** This is irreversible.

## Read before
- `scripts/restore.mjs`
- `deploy/backup.sh` (the encryption format that this decrypts)
- `SECURITY.md` §4 (backups + drills)
