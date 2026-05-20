---
name: preflight
description: Validate every secret / variable that /deploy needs by hitting the real vendor APIs. Returns a clear pass/fail table in ~60s, catching missing or mis-scoped tokens BEFORE deploy.yml provisions anything. Use when the user says "preflight", "validate secrets", "check deploy readiness", "/preflight", or before invoking /deploy on a fresh fork or after rotating any token.
---

# /preflight — Validate deploy secrets in 60s

Runs `scripts/preflight.mjs` via `.github/workflows/preflight.yml`. Hits DigitalOcean, Cloudflare, GitHub, and GHCR with each secret to confirm it's set and scoped correctly. Verifies the SSH private key matches the SSH_PUBKEY variable. Exits non-zero with a clear remediation hint for each failure.

> **Run this before every `/deploy` on a fresh fork.** It surfaces the misconfigurations that otherwise cost 15+ min per failed deploy iteration.

## Claude's job in this skill

1. Confirm the operator has the basics set (the `/first-fork` checklist).
2. Compose the exact `gh workflow run preflight.yml` command for them to paste.
3. After the run, summarize the `✗` rows and walk through fixes one-by-one.
4. **Do not invoke `/deploy` while preflight is red** — the same secrets fail, just 15 min later.

## Inputs

| Input | Notes |
|---|---|
| `env` | `staging` (lighter required set) or `prod` (full set, including backup secrets) |
| `domain` | Optional. If supplied, preflight also probes the Cloudflare zone for that apex. |

## Trigger command

```sh
gh workflow run preflight.yml -f env=staging -f domain=app.staging.example.com
```

For prod (validates the additional backup secrets):

```sh
gh workflow run preflight.yml -f env=prod -f domain=app.example.com
```

## What gets validated

**Required for staging** (also required for prod):
- `DO_API_TOKEN` — calls `GET /v2/account`
- `CLOUDFLARE_API_TOKEN` — `/user/tokens/verify` + (if `--domain` passed) `/zones?name=<apex>`
- `GH_AUTOMATION_TOKEN` — `/user` + probes `actions/secrets/public-key` to confirm `secrets:write`
- `SSH_PRIVATE_KEY` — `ssh-keygen -y -P ''` parses cleanly; derived pubkey body matches `SSH_PUBKEY`
- `SSH_PUBKEY` (variable) — matches `SSH_PRIVATE_KEY`
- `CADDY_EMAIL` (variable) — looks like an email
- `GHCR_PULL_TOKEN` — `GET https://ghcr.io/token` with Basic auth returns a pull token

**Required for prod, skipped on staging:**
- `BACKUP_AGE_RECIPIENT` — format check (`age1...`)
- `BACKUP_AGE_IDENTITY` — format check (`AGE-SECRET-KEY-1...`)
- `RCLONE_CONFIG` — looks like a real rclone INI

**Optional (warn-only):**
- `SENTRY_DSN` — DSN URL shape check
- `BETTER_UPTIME_API_KEY` — presence check only

## Tailing the run

```sh
gh run watch
```

Or open the workflow run in the GitHub UI — the log prints a single table with `✓ / ✗ / -` per row.

## Reading preflight output

Each `✗` row has a `remedy:` line under it. Examples:

```
✗ DO_API_TOKEN                  not set
    remedy: gh secret set DO_API_TOKEN -b 'dop_v1_...' (mint at cloud.digitalocean.com → API → Tokens, full scope)

✗ CLOUDFLARE_API_TOKEN          token valid but zone "example.com" not found on this account
    remedy: Move the domain to this CF account, OR re-scope the token to the right zone, OR pass --cf-zone explicitly at deploy time.

✗ SSH_PRIVATE_KEY               private key is encrypted with a passphrase
    remedy: Strip the passphrase: ssh-keygen -p -f <key> -P '<old>' -N '' then re-set the secret.
```

## Concurrency

`concurrency: { group: preflight-<env>, cancel-in-progress: true }` — newer runs supersede older ones. No state changes happen, so cancellation is safe.

## What preflight does NOT do

- Does NOT provision anything. No droplets, no DNS records, no GitHub config writes.
- Does NOT verify Sentry/BetterUptime token scopes — only presence.
- Does NOT verify rclone can actually reach the Spaces bucket — only that the INI parses.
- Does NOT replace running `/deploy --dry-run` for plan-level review.

## Read before deeper changes

- `scripts/preflight.mjs` — single-file validator; reuses `scripts/lib/{do,cloudflare,github,secrets}.mjs`.
- `.github/workflows/preflight.yml` — workflow wiring.
- `.claude/skills/first-fork/SKILL.md` — the canonical secret checklist.
