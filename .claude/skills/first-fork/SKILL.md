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

## Minimum to get staging up

If you just want a staging URL to test against, you need **5 secrets** + **2 variables**. The other ~7 items in §3 below are only required for prod (or are opt-in observability).

**Required (staging will not work without these):**

1. `DO_API_TOKEN` — DigitalOcean PAT (full account scope; DO has no fine-grained PATs)
2. `CLOUDFLARE_API_TOKEN` — token with `Zone.DNS:Edit` on the project zone
3. `GH_AUTOMATION_TOKEN` — GH PAT with `repo` + `workflow` scopes
4. `SSH_PRIVATE_KEY` — ed25519 private key, **no passphrase** (CI can't prompt)
5. `GHCR_PULL_TOKEN` — classic PAT with `read:packages` scope ONLY (one token works across all your forks)

**Required variables (not secrets):**

6. `SSH_PUBKEY` — the matching public key
7. `CADDY_EMAIL` — Let's Encrypt contact email

**Skipped on staging if absent (required for prod):**

- `BACKUP_AGE_RECIPIENT` + `BACKUP_AGE_IDENTITY` — encrypted backups
- `RCLONE_CONFIG` — off-host backup target

When any of those three are missing on a staging deploy, `scripts/deploy.mjs` writes placeholder files into cloud-init and sets `BACKUP_ENABLED=false` so the backup sidecar no-ops. Set them before promoting to prod (the `prod` env requires them).

**Always optional (warn-only):**

- `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` — error tracking
- `BETTER_UPTIME_API_KEY` — uptime monitoring

### Validate the seven before /deploy

After setting the staging-required secrets + variables, run:

```sh
gh workflow run preflight.yml -f env=staging -f domain=app.staging.example.com
```

This hits each vendor API and prints a pass/fail table in ~60s. Only proceed to `/deploy` once preflight is green — it surfaces missing/mis-scoped secrets in seconds instead of 15 min into a failed deploy.

### One-time — push at least one commit to main so the GHCR image exists

`/deploy` pulls `ghcr.io/<owner>/<repo>:latest` from GHCR. That image is published by `docker-build.yml`, which runs on every push to `main`. **For a fresh fork, push any commit to `main` before the first `/deploy`** so the image exists. After the first push, the build takes ~3–5 min; preflight will tell you when it's pullable.

GHCR packages default to **private**. After the first `docker-build.yml` succeeds, visit `https://github.com/<owner>/<repo>/pkgs/container/<repo>` → **Package settings** → Danger zone → **Change visibility** → **Public**. Acceptable for staging — the image carries no secrets (secrets live in env vars, not in layers). If you prefer to keep it private, grant your `GHCR_PULL_TOKEN`'s owner read access via the package's "Manage Actions access" page.

If the image is missing or unpullable, the new `/preflight` row "GHCR :latest manifest" tells you exactly which fix to apply.

### Optional but recommended — build a base snapshot

If you want staging deploys to complete in **~3–5 min** instead of ~10–15 min, pre-bake a DO custom image with Docker + Caddy + age + rclone pre-installed:

```sh
gh workflow run build-snapshot.yml -f region=fra1
```

- One-time cost: ~6–9 min (apt install + snapshot creation).
- Storage cost: ~$0.20/mo per region.
- Savings: ~3–5 min on every subsequent `/deploy` to that region.
- Snapshots are region-locked. Rebuild for each DO region you deploy to.
- Refresh every ~3 months for security updates: `gh workflow run build-snapshot.yml -f region=fra1 -f force_rebuild=true`.

If you skip this, `/deploy` falls back to stock Ubuntu + a full cloud-init (~4 min slower) — no functional difference, just slower.

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

# age recipient (public half) -- backups are encrypted to this key. Generated
# during /first-fork §6 below as the line starting AGE-RECIPIENT-1...
# Cloud-init writes this to /opt/backup/recipient on the Droplet.
gh secret set BACKUP_AGE_RECIPIENT -b 'AGE-RECIPIENT-1...'

# age identity (private half) for decrypting off-host backups during restore.
# Pasted as the AGE-SECRET-KEY-1... line. Lives ONLY in this repo secret --
# never on the host that performs encryption (host compromise can't decrypt
# prior backups). Generated during /first-fork §6 below.
gh secret set BACKUP_AGE_IDENTITY -b 'AGE-SECRET-KEY-1...'

# rclone config (full file contents) for off-host backup target. Cloud-init
# writes this to /opt/backup/rclone.conf (mode 600) on the Droplet during
# /deploy. Contains DO Spaces access keys -- Restricted.
gh secret set RCLONE_CONFIG < /opt/backup/rclone.conf

# GHCR_PULL_TOKEN -- a CLASSIC PAT (NOT fine-grained) with the read:packages
# scope ONLY. Lets the Droplet's Docker daemon pull the fork's private GHCR
# image. Mint at https://github.com/settings/tokens (under "write:packages",
# tick ONLY the read:packages child checkbox). Recommended expiration: 1 year.
# This is the ONE GH token that is reusable across ALL projects in the
# operator's account -- the read:packages scope is account-wide, not repo-
# scoped, so the same token works for every fork. Leak blast radius:
# attacker can pull the operator's private images, NOT access repo source.
gh secret set GHCR_PULL_TOKEN -b 'ghp_...'

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

Run this **locally** on the operator's laptop (not the runner, not the host):

```sh
age-keygen -o /tmp/<slug>.age.key
# Output looks like:
#   # created: 2026-05-19T12:00:00Z
#   # public key: age1abcdef... (the recipient)
#   AGE-SECRET-KEY-1QQQQQQQQ...  (the identity / private half)

# Recipient (public half) -- the `age1...` line. Cloud-init writes this to
# /opt/backup/recipient on the Droplet automatically during /deploy.
awk '/public key:/ {print $4}' /tmp/<slug>.age.key   # copy the AGE-RECIPIENT-1...
gh secret set BACKUP_AGE_RECIPIENT -b 'age1...'

# Identity (private half) -- the AGE-SECRET-KEY-1... line.
# Used by restore-test.yml to decrypt during quarterly restore drills.
grep '^AGE-SECRET-KEY' /tmp/<slug>.age.key | gh secret set BACKUP_AGE_IDENTITY

shred -u /tmp/<slug>.age.key
```

**The identity (private key) never lives on the host that runs encryption.**
A host compromise cannot decrypt prior backups; only the GH repo secret
unlocks them.

### 7. Configure rclone for the backup target

Create a DigitalOcean Spaces access key:

1. `cloud.digitalocean.com → API → Spaces Keys → Generate New Key`
2. Note the access key and secret (the secret is shown ONCE).

Compose the `rclone.conf` locally:

```sh
cat > /tmp/<slug>.rclone.conf <<'EOF'
[spaces]
type = s3
provider = DigitalOcean
access_key_id = DO00XXXXXXXXXXXXX
secret_access_key = abcdef...
endpoint = fra1.digitaloceanspaces.com
acl = private
EOF

gh secret set RCLONE_CONFIG < /tmp/<slug>.rclone.conf
shred -u /tmp/<slug>.rclone.conf
```

**Cloud-init writes this to `/opt/backup/rclone.conf` (mode 0600) on the
Droplet automatically during `/deploy`.** The Spaces bucket itself is
auto-created on first boot via `rclone mkdir` in cloud-init's runcmd.

After first deploy, the Portainer stack env carries `RCLONE_REMOTE=spaces`,
`BACKUP_BUCKET=<slug>-backups-<env>`, and `BACKUP_ENABLED=true` -- all set
by `/deploy`. No manual SSH step required.

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
| `BACKUP_AGE_RECIPIENT` | secret | repo | age public key (recipient); cloud-init writes to `/opt/backup/recipient` |
| `BACKUP_AGE_IDENTITY` | secret | repo | age private key; never on host |
| `RCLONE_CONFIG` | secret | repo | full rclone.conf contents (contains DO Spaces keys); cloud-init writes to `/opt/backup/rclone.conf` mode 0600 |
| `GHCR_PULL_TOKEN` | secret | repo | classic PAT, `read:packages` only; account-wide so reusable across all forks |
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
