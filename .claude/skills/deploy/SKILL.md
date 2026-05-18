---
name: deploy
description: Provision a fresh Droplet, Cloudflare DNS, GitHub secrets, Portainer stack, and trigger the first deploy for a forked project. One environment per invocation (--env staging|prod). Use when the user says "deploy this", "spin up staging", "provision the fork", "/deploy", or asks for end-to-end automated provisioning beyond what /first-fork's manual checklist covers.
---

# /deploy — Provision + first deploy in one command

Goes from "fresh fork on GitHub" to "live HTTPS URL" without manual clicks. One environment per run; rerun with `--env prod` for production.

## Inputs (asked once)

| Flag | Source |
|---|---|
| `--env` | `staging` (default) or `prod` |
| `--domain` | e.g. `app.staging.example.com` |
| `--do-token` | DigitalOcean API token (full-account scope; use a dedicated automation account) |
| `--cf-token` | Cloudflare API token scoped to `Zone.DNS:Edit` on one zone |
| `--gh-token` | GitHub PAT with `repo` + `workflow` scopes |
| `--ssh-pubkey` | Operator's SSH public key (e.g. `cat ~/.ssh/id_ed25519.pub`) |
| `--caddy-email` | Email for Let's Encrypt registration |

Slug comes from `package.json` name (set by `/rebrand`). Pass `--slug` to override.

## What it does (in order)

1. Validates all three tokens upfront (fails fast if any are wrong)
2. **DO:** ensures SSH key + creates Droplet (`s-1vcpu-2gb`, fra1, cloud-init bootstrap) + reserves IPv4
3. **CF:** upserts A record `<domain>` → reserved IP (proxied=false; LE HTTP-01 needs this)
4. **Portainer:** SSH in, install CE, claim admin window (within 5 min), record admin password to state file
5. **GitHub:** sets ~12 repo secrets + creates env-scoped secrets for `<env>` + applies main branch ruleset
6. **Stack:** creates Portainer stack from `docker-compose.prod.yml` + registers stack webhook (T-04 SHA pinning) + writes `PORTAINER_WEBHOOK_URL` back to GH secrets
7. **First deploy:** triggers the webhook with the latest main SHA + polls `/api/health` for 3 minutes
8. **Uptime monitor** (optional): if `BETTER_UPTIME_API_KEY` is set (env var or `--better-uptime-key`), registers a status monitor against `https://<domain>/api/health` via the Better Uptime API and persists the monitor id to `.deploy-state.<env>.json`. `--destroy` removes it. Skips with a warning if the key is unset (early forks deploy without uptime).
9. **Sentry env passthrough** (optional): if `--sentry-dsn` (or `SENTRY_DSN` env) is provided, sets `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` on the Portainer stack env and as GH repo secrets. Sentry DSNs are public-by-design (see ADR-002).

## Idempotency

State file at `.deploy-state.<env>.json` (gitignored) tracks every resource ID. Rerun is safe — finished steps skip.

```
npm run deploy -- --env staging --resume          # pick up after partial run
npm run deploy -- --env staging --dry-run         # plan only, no API calls
npm run deploy -- --env staging --destroy --yes   # tear it down
```

## Cost preview

The script prints expected monthly cost (~$17/mo per env: Droplet ~$12, Spaces ~$5, reserved IP $0 attached) and requires `--yes` before creating anything.

## Operator workflow

```
# 1. Inside the fork's git repo:
git checkout main

# 2. Run /deploy. Claude prompts for the seven inputs, then runs:
npm run deploy -- \
  --env staging \
  --domain tasks.staging.example.com \
  --do-token dop_v1_... \
  --cf-token <token> \
  --gh-token ghp_... \
  --ssh-pubkey "$(cat ~/.ssh/id_ed25519.pub)" \
  --caddy-email you@example.com \
  --yes

# 3. Wait ~5-8 min. Output:
#   ✓ deploy ok at https://tasks.staging.example.com
#   Portainer: https://<ip>:9443 (admin password printed to state file)

# 4. Smoke-check the login flow at the URL.
```

## What the script does NOT do (operator one-off)

- DigitalOcean Spaces bucket creation: the v2 `/v2/spaces/keys` endpoint is gated on some accounts. Script prints a hint to create the bucket once in the DO console, then re-runs the spaces-key step.
- Setting `BACKUP_AGE_IDENTITY` / `RCLONE_CONFIG`: requires `age-keygen` on the host. The script can generate the keypair if `age-keygen` is on PATH, but the operator chooses where to store the private identity. Default flow: skill walks through `/first-fork` steps 5-6 for these.
- SMTP credentials: per-fork choice (provider, account). Set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` in Portainer stack env after deploy.
- **Sentry account + project + auth token** (per ADR-002): the operator creates one Sentry project per env on sentry.io, captures the DSN (pass to `/deploy` via `--sentry-dsn`), and adds `SENTRY_AUTH_TOKEN` repo secret + `SENTRY_ORG` / `SENTRY_PROJECT` repo vars for CI source-map upload. `/first-fork` walks through this once.
- **Better Uptime account + key** (per ADR-002): operator creates one Better Stack account per project, generates a Telemetry/Uptime API key, exposes it to `/deploy` via `BETTER_UPTIME_API_KEY` env or `--better-uptime-key`. Walks through in `/first-fork`.
- Branch protection ruleset: applied automatically, but requires the PAT to have admin scope. Falls back to a warning if not allowed (then operator applies via UI).

## Honest failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `DO 429` repeatedly | Burst rate limit | Script backs off automatically; re-run with `--resume` |
| `CF zone not found` | Token scoped to wrong zone, or domain uses 3-label TLD like `.com.om` | Pass `--cf-zone <exact-zone-name>` |
| `LE challenge fails` | CF record is proxied=true | Script forces proxied=false; if operator flips after, Caddy will fail. Re-run with proxied=false |
| `Portainer init -> 409` | Admin window expired (>5 min after install) | SSH in, `docker rm -f portainer && docker volume rm portainer_data`, re-run |
| `Webhook trigger -> 404` | Portainer stack webhook deleted in UI | Re-run; script re-creates webhook |
| Reserved IP leaks ($4/mo) | Droplet destroyed without `--destroy` flag | `--destroy --yes` always unassigns + releases |

## Report back

After a successful run, print:
- Deployed URL + health URL
- Portainer admin URL + the password (one-time -- operator captures it from logs / state file then deletes from logs)
- Last 3 created resources with their DO/CF/GH IDs (for reference)
- Next steps: `/promote` to ship to prod, `/scaffold-entity` to add a model

## Read before deeper changes
- `scripts/deploy.mjs` — orchestrator
- `scripts/lib/do.mjs`, `cloudflare.mjs`, `github.mjs`, `portainer.mjs` — per-vendor clients
- `deploy/cloud-init.yml` — droplet first-boot script
- `SECURITY.md` §6 (Restricted secrets)
