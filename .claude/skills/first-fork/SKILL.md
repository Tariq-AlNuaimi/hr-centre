---
name: first-fork
description: Walk the operator through one-time setup after forking the template into a new project. Covers repo secrets, GH Environments, branch protection, the first /deploy via GitHub Actions, and the first ADR. Use when the user says "set up a new project", "fork bootstrap", "first-fork", "I just cloned the template", "/first-fork".
---

# /first-fork — New project bootstrap (CI-driven ops model)

> **The template is now CI-driven (ADR-004).** All ops scripts run via GitHub
> Actions `workflow_dispatch`. Tokens live as GitHub repo / environment
> secrets and never traverse Claude chat. This skill walks through the
> one-time setup that puts those secrets in place; after that, `/deploy`,
> `/promote`, `/rollback`, `/restore`, `/new-project`, and `/release` all
> trigger CI workflows.

## Preconditions

- The operator has the `gh` CLI installed locally and is authenticated
  (`gh auth status`).
- The operator has admin permissions on the new repo.
- DigitalOcean, Cloudflare, GitHub PATs are minted; SMTP / Sentry / Better
  Uptime accounts created where in scope (see §12 below).
- A Portainer instance + an off-host backup target are available, OR the
  operator will let `/deploy` provision a fresh Droplet that hosts both.

## Steps

### 1. Create the fork

```sh
gh repo create <owner>/<slug> \
  --template Tariq-AlNuaimi/fullstack-vibe-template \
  --private \
  --clone
cd <slug>
```

The created repo inherits all six ops workflows
(`.github/workflows/{deploy,promote,rollback,restore,new-project,release}.yml`)
plus the gate workflows (verify, sast, secrets-scan, audit-retention,
restore-test, docker-build).

### 2. Rebrand

```sh
npm install
npm run rebrand -- --slug <kebab-slug> --name '<Display Name>' --owner <gh-owner>
git add -A && git commit -m 'chore: rebrand from template' && git push
```

### 3. Set repo-level secrets

These are shared across `staging` and `prod`. Use `gh secret set`:

```sh
# DigitalOcean PAT, full-account scope (DO has no fine-grained PATs).
gh secret set DO_API_TOKEN -b 'dop_v1_...'

# Cloudflare API token, scoped to Zone.DNS:Edit on one zone.
gh secret set CLOUDFLARE_API_TOKEN -b '...'

# GitHub PAT with repo + workflow scopes. Used by /deploy + /new-project to
# set per-repo secrets on the fork. (Falls back to GITHUB_TOKEN inside a
# workflow if not set, but that token lacks cross-repo scopes.)
gh secret set GH_AUTOMATION_TOKEN -b 'ghp_...'

# Better Uptime API key. Optional -- /deploy skips uptime registration if unset.
gh secret set BETTER_UPTIME_API_KEY -b '...'

# Sentry auth token for CI source-map upload. Scope: project:releases + org:read.
gh secret set SENTRY_AUTH_TOKEN -b 'sntrys_...'

# SSH private key the workflows use to reach the Droplet during /deploy.
# Generate fresh per project; never reuse a personal key.
ssh-keygen -t ed25519 -f /tmp/<slug>-ops -N ''
gh secret set SSH_PRIVATE_KEY < /tmp/<slug>-ops

# age identity for decrypting off-host backups. Generated during /first-fork §6;
# pasted as the AGE-SECRET-KEY-1... line.
gh secret set BACKUP_AGE_IDENTITY -b 'AGE-SECRET-KEY-1...'

# rclone config (full file contents) for off-host backup target.
gh secret set RCLONE_CONFIG < /opt/backup/rclone.conf
```

### 4. Set repo-level variables (non-secret)

Variables are public — anyone with read access to the repo can see them.

```sh
gh variable set CADDY_EMAIL -b 'you@example.com'
gh variable set SSH_PUBKEY  -b "$(cat /tmp/<slug>-ops.pub)"
gh variable set SENTRY_ORG     -b 'your-org'
gh variable set SENTRY_PROJECT -b 'your-project'
```

### 5. Create the GitHub Environments

Per-env secrets and protection rules live here.

```sh
# Create the environments via API (gh CLI doesn't expose them directly).
gh api -X PUT repos/<owner>/<slug>/environments/staging \
  -f wait_timer=0 \
  --raw-field 'reviewers=[]' \
  --raw-field 'deployment_branch_policy=null'

gh api -X PUT repos/<owner>/<slug>/environments/prod \
  -f wait_timer=0 \
  --raw-field 'deployment_branch_policy=null' \
  -F 'reviewers[][type]=User' \
  -F "reviewers[][id]=$(gh api user --jq .id)"
```

Then set the per-env `SENTRY_DSN` variable (one Sentry project per env is
the recommended pattern — see ADR-002):

```sh
gh variable set SENTRY_DSN --env staging -b 'https://...staging.ingest.sentry.io/...'
gh variable set SENTRY_DSN --env prod    -b 'https://...prod.ingest.sentry.io/...'
```

### 6. Generate age keypair for backups

On the staging / prod host (NOT the operator's laptop, NOT the GitHub runner):

```sh
ssh ops@<host>
age-keygen -o /tmp/backup.identity
awk '/public key:/ {print $4}' /tmp/backup.identity > /opt/backup/recipient
chmod 644 /opt/backup/recipient
cat /tmp/backup.identity     # copy the AGE-SECRET-KEY-1... line
shred -u /tmp/backup.identity
```

Paste the secret line into the `BACKUP_AGE_IDENTITY` repo secret (set in §3).
**The identity (private key) never lives on the host that runs encryption.**

### 7. Configure rclone for the backup target

On the host:

```sh
rclone config         # walk the wizard, save to /opt/backup/rclone.conf mode 600
```

Set Portainer stack env vars (after first deploy):
- `RCLONE_REMOTE=<name>`
- `BACKUP_BUCKET=<bucket-name>`
- `BACKUP_ENABLED=true`

Copy the contents of `/opt/backup/rclone.conf` into the `RCLONE_CONFIG`
repo secret (set in §3).

### 8. Branch protection on main

In `Settings -> Rules -> Rulesets`, create a ruleset on `main` requiring:
- Pull request before merge (1 approval minimum)
- Required status checks: `Verify`, `Secrets scan`, `SAST`
- Block force pushes
- Restrict deletions

The `/deploy` workflow attempts to apply this automatically if the
`GH_AUTOMATION_TOKEN` has admin scope; otherwise it warns and the operator
applies via UI.

### 9. First deploy

```sh
gh workflow run deploy.yml \
  -f env=staging \
  -f domain=app.staging.example.com \
  -f slug=<slug> \
  -f action=provision-and-deploy

# Watch the run:
gh run watch
```

The workflow:
1. Restores `.deploy-state.staging.json` from the orphan `deployment-state`
   branch (no-op on first run).
2. Runs `scripts/deploy.mjs --env staging --domain ... --slug ... --yes`.
3. Persists the updated state back to `deployment-state`.

Expected runtime: 5–10 min.

### 10. First ADR

Run `/adr` with a title that captures the project's *purpose* (not the
stack — ADR-001 covers the stack). Example: `Acme Portal scope and tier
classification`. Forces a written record of what the fork is for, who owns
it, and what data class it targets.

### 11. Smoke check

```sh
curl -s https://<domain>/api/health         # expect 200
# Log in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the Portainer stack env.
# Rotate the seed password on first login and update the Portainer env.
```

### 12. Observability (Sentry + Better Uptime)

Both are operator-side SaaS per ADR-002.

**Sentry:**
1. Sign in at https://sentry.io → create projects (one per env).
2. Capture each DSN; set `SENTRY_DSN` as a per-env variable (§5).
3. Create an auth token with `project:releases` + `org:read`; set as repo
   secret `SENTRY_AUTH_TOKEN` (§3).
4. Set `SENTRY_ORG` + `SENTRY_PROJECT` as repo variables (§4).

**Better Uptime:**
1. Sign in at https://betterstack.com/uptime → create a team for the project.
2. Settings → API tokens → generate a Telemetry/Uptime key.
3. Set as repo secret `BETTER_UPTIME_API_KEY` (§3). `/deploy` registers a
   monitor automatically; `/deploy --destroy` removes it.

### 13. (Optional) Trigger the maintenance workflows once

```sh
gh workflow run audit-retention.yml      # expect 200 from /api/internal/audit-purge
gh workflow run restore-test.yml         # expect green after first nightly backup
```

## Repo / env secret + variable summary

| Name | Type | Scope | Source |
|---|---|---|---|
| `DO_API_TOKEN` | secret | repo | DigitalOcean PAT |
| `CLOUDFLARE_API_TOKEN` | secret | repo | Cloudflare token, Zone.DNS:Edit |
| `GH_AUTOMATION_TOKEN` | secret | repo | GitHub PAT, `repo`+`workflow` |
| `BETTER_UPTIME_API_KEY` | secret | repo | Better Uptime API key (optional) |
| `SENTRY_AUTH_TOKEN` | secret | repo | Sentry auth token |
| `SSH_PRIVATE_KEY` | secret | repo | ed25519 private key for Droplet access |
| `BACKUP_AGE_IDENTITY` | secret | repo | age private key |
| `RCLONE_CONFIG` | secret | repo | full rclone.conf contents |
| `CADDY_EMAIL` | variable | repo | Let's Encrypt email |
| `SSH_PUBKEY` | variable | repo | matching public key |
| `SENTRY_ORG` / `SENTRY_PROJECT` | variable | repo | Sentry slugs |
| `SENTRY_DSN` | variable | env (staging / prod) | per-env Sentry DSN |

## Why no seed-secrets workflow?

A `workflow_dispatch` that took a JSON blob of secrets and called the GitHub
API to set each one was considered and rejected. The `workflow_dispatch`
input panel logs (masked) inputs in the run UI; misuse risk outweighed
convenience. Operators run `gh secret set` from their laptop instead. See
ADR-004 for the full reasoning.

## Report back

After bootstrap, list:
- Every secret + variable that was set.
- The GitHub Environments created.
- The branch-protection state.
- The first staging deploy's URL + health check status.
- The first ADR filename.
