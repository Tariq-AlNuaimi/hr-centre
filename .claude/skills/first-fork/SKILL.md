---
name: first-fork
description: Walk the operator through one-time setup after forking the template into a new project. Covers repo secrets, age keypair, rclone remote, Portainer stack, branch protection, rebrand, and the first ADR. Use when the user says "set up a new project", "fork bootstrap", "first-fork", "I just cloned the template", "/first-fork".
---

# /first-fork — New project bootstrap

> **Most operators should use `/new-project` or `/deploy` instead.**
> Those skills automate the GitHub create + secret-setting + Portainer install + DNS that the rest of this doc walks through manually. Use `/first-fork` only if you can't grant DO/CF/GH API tokens to the automation, or if you're attaching to a pre-existing Portainer/host.

One-time checklist to run on a fresh fork of the template. Each step is a deliberate decision -- ask the operator before doing it if there is any ambiguity. None of these touch the operator's local machine; everything is GitHub MCP / SSH / browser actions.

## Preconditions
- The operator has already forked or duplicated `fullstack-vibe-template` into a new repo.
- The operator has admin permissions on the new repo.
- A Portainer instance + an off-host backup target (S3-compatible) are available.

## Steps

### 1. Rebrand
Run `/rebrand` first. It rewrites `package.json` name, Docker image references, container names, and `NEXT_PUBLIC_APP_NAME`. Without this, every fork ships as `fullstack-next-template`.

Ask for: project slug (kebab-case, e.g. `acme-portal`), display name (e.g. `Acme Portal`), GHCR owner (defaults to the new repo's owner).

### 2. Generate AUTH_SECRET
```
openssl rand -base64 32
```
Store in GitHub repo secret `AUTH_SECRET`. Rotation invalidates every session, so do not reuse across environments.

### 3. Generate AUDIT_PURGE_TOKEN
```
openssl rand -base64 48
```
Store in GitHub repo secret `AUDIT_PURGE_TOKEN` AND in the Portainer stack env. The monthly `audit-retention.yml` workflow uses the secret to call `/api/internal/audit-purge`.

### 4. Generate POSTGRES_PASSWORD
```
openssl rand -base64 24
```
Store in the Portainer stack env (not the GitHub repo secret — the DB password never needs to reach CI).

### 5. Generate age keypair for backups
On the staging / prod host (NOT the operator's laptop):
```
ssh ops@<host>
age-keygen -o /tmp/backup.identity
awk '/public key:/ {print $4}' /tmp/backup.identity > /opt/backup/recipient
chmod 644 /opt/backup/recipient
cat /tmp/backup.identity     # copy the AGE-SECRET-KEY-1... line
shred -u /tmp/backup.identity
```
Paste the secret line into GitHub repo secret `BACKUP_AGE_IDENTITY`. **The identity (private key) never lives on the host that runs encryption** — a host compromise must not decrypt prior backups.

### 6. Configure rclone for the backup target
On the host:
```
rclone config
```
Walk through the wizard to add a remote. Save to `/opt/backup/rclone.conf` (mode 600). Note the remote name and bucket. Set Portainer stack env vars:
- `RCLONE_REMOTE=<name>` (e.g. `spaces`, `b2`, `r2`)
- `BACKUP_BUCKET=<bucket-name>`
- `BACKUP_ENABLED=true`

Also paste the rclone config + remote details into GitHub repo secrets so `restore-test.yml` can decrypt + restore in CI:
- `RCLONE_CONFIG` (full file contents)
- `RCLONE_REMOTE`
- `BACKUP_BUCKET`

### 7. Configure MinIO scoped key (closes T-09)
Do not use the MinIO root key in the app. Mint a scoped key with bucket-only permissions:
```
mc admin user add app/ <access-key> <secret-key>
mc admin policy attach app/ readwrite --user <access-key>
```
Set `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` in the Portainer stack env to the scoped values. Root creds stay isolated to the mc admin shell.

### 8. Create the Portainer stack
In Portainer, create a new stack pointing at the new repo's `docker-compose.prod.yml`. **Use a STACK webhook, not a service webhook**, so `?IMAGE_TAG=sha-<short>` is honored (T-04 SHA pinning).

Copy the webhook URL into GitHub repo secret `PORTAINER_WEBHOOK_URL`.

Also set `PROD_BASE_URL` in repo secrets to the deployed app URL (e.g. `https://app.acme-portal.example.com`) — needed by `audit-retention.yml`.

### 9. Configure SMTP if email is in scope
If the app sends transactional email (Auth.js OAuth invites, password resets in a future iteration), set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` in the Portainer stack env. The template ships without SMTP; this is a per-fork choice.

### 10. Enable branch protection on `main`
In the new repo, Settings -> Rules -> Rulesets. Create a ruleset on `main` requiring:
- Pull request before merge (1 approval minimum)
- Required status checks: `Verify`, `Secrets scan`, `SAST`
- Block force pushes
- Restrict deletions

The template ships the workflow files, but rulesets cannot be configured by the workflow itself — the operator does this once.

### 11. Write the first project ADR
Run `/adr` with a title that captures the project's *purpose* (not the stack — ADR-001 covers the stack). Example title: "Acme Portal scope and tier classification". This forces a written record of what the fork is for, who owns it, and what data class it targets.

### 12. Observability (Sentry + Better Uptime)
Both are operator-side SaaS per ADR-002. The template ships the wiring; you create the accounts once per project.

**Sentry:**
1. Sign in at https://sentry.io → create a new project (platform: Next.js). Capture the DSN.
2. (Optional) Create one Sentry project per environment (staging, production) for clean separation. Reuse the same org.
3. Set GitHub **repo secret** `SENTRY_AUTH_TOKEN` to a Sentry auth token with `project:releases` + `org:read` scope (needed by CI for source-map upload). Without it the upload step skips with a warning -- the app still runs, just without symbolicated stack traces.
4. Set GitHub **repo vars** (not secrets) `SENTRY_ORG` and `SENTRY_PROJECT` (e.g. `acme`, `acme-portal-prod`).
5. When you run `/deploy`, pass `--sentry-dsn <DSN>` (or export `SENTRY_DSN`) so the stack env carries it. The same DSN doubles as `NEXT_PUBLIC_SENTRY_DSN` (DSNs are public-by-design — SECURITY.md §6).
6. If you skip Sentry: leave the secrets unset. Everything still works; errors just aren't reported.

**Better Uptime (Better Stack):**
1. Sign in at https://betterstack.com/uptime → create a team for the project.
2. Settings → API tokens → generate a Telemetry/Uptime API key.
3. Export `BETTER_UPTIME_API_KEY` in the shell when you run `/deploy` (or pass `--better-uptime-key`). `/deploy` will register a status monitor against `https://<domain>/api/health` and persist the monitor id to `.deploy-state.<env>.json`. `--destroy` removes it.
4. (Optional) Add an on-call rotation + escalation policy in the Better Uptime UI.
5. If you skip Better Uptime: leave the env unset. `/deploy` prints a warning and continues.

### 13. Smoke deploy
Push a trivial commit to `main`. Watch:
- `verify.yml` -> green
- `secrets-scan.yml` -> green
- `sast.yml` -> green
- `docker-build.yml` -> green; pushes to GHCR; calls the Portainer webhook
- App at `PROD_BASE_URL` answers `/api/health` with 200

Log into the app with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (from the Portainer stack env, not committed). **Rotate the seed password on first login** and update the Portainer env.

### 14. (Optional) Workflow dispatches to verify the chain
- Trigger `audit-retention.yml` `workflow_dispatch` -> expect a 200 with a count.
- Trigger `restore-test.yml` `workflow_dispatch` -> expect a green run after the first nightly backup completes (so there's something on the remote to restore).

## Report back
List every secret that was set, every Portainer stack env that was set, and the smoke-deploy status. The operator stores nothing locally; everything is in repo secrets + Portainer + the host's `/opt/backup/`.

## Repository secrets summary (paste into the ops doc per fork)

| Secret | Source | Stored in |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | GH repo + Portainer stack |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` | Portainer stack only |
| `AUDIT_PURGE_TOKEN` | `openssl rand -base64 48` | GH repo + Portainer stack |
| `BACKUP_AGE_IDENTITY` | `age-keygen` private key | GH repo only |
| `RCLONE_CONFIG` | `cat /opt/backup/rclone.conf` | GH repo only |
| `RCLONE_REMOTE` | rclone remote name | GH repo + Portainer stack |
| `BACKUP_BUCKET` | rclone bucket / container | GH repo + Portainer stack |
| `PORTAINER_WEBHOOK_URL` | Portainer stack webhook | GH repo only |
| `PROD_BASE_URL` | deployed app URL | GH repo only |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO admin | Portainer stack only |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | scoped mc user | Portainer stack only |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | one-shot bootstrap | Portainer stack only; rotate on first login |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry project DSN | GH repo + Portainer stack (public-by-design, not Restricted) |
| `SENTRY_AUTH_TOKEN` | Sentry org auth token | GH repo secret only (CI source-map upload) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry slugs | GH repo **vars** (not secrets) |
| `BETTER_UPTIME_API_KEY` | Better Uptime API token | Operator shell at `/deploy` time (Restricted) |
