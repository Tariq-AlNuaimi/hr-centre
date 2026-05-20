---
name: deploy
description: Provision a fresh Droplet, Cloudflare DNS, GitHub secrets, Portainer stack, and trigger the first deploy for a forked project. Executes via the `deploy.yml` GitHub Actions workflow (ADR-004). Use when the user says "deploy this", "spin up staging", "provision the fork", "/deploy".
---

# /deploy — Trigger the deploy workflow

Goes from "fresh fork on GitHub" to "live HTTPS URL" by dispatching the
`deploy.yml` GitHub Actions workflow. One environment per run.

> **Executes via GH Actions workflow.** Claude proposes inputs; the operator
> dispatches; CI runs `scripts/deploy.mjs` with credentials from repo + env
> secrets. See ADR-004.

## Claude's job in this skill

1. **Run `/preflight` first.** Before composing the `gh workflow run deploy.yml` command, ALWAYS dispatch `preflight.yml` for the target env and wait for green. Preflight runs in ~60s and catches the same misconfigured secrets that otherwise cost 15+ min into a failed deploy iteration. If preflight fails, surface each `✗` row with its remedy and DO NOT proceed.
2. Collect the four inputs below from the operator.
3. Confirm that `/first-fork` has already set the repo secrets + GH
   Environments. For staging the minimum is 5 secrets + 2 variables (see `/first-fork`); for prod, add the three backup secrets.
4. Compose the exact `gh workflow run` command for the operator to paste.
5. Optionally tail the run (see "Tailing" below).

### Step 0 — preflight

```sh
gh workflow run preflight.yml -f env=staging -f domain=app.staging.example.com
gh run watch
```

Only proceed past this step once preflight exits 0.

## Inputs Claude collects

| Input | Notes |
|---|---|
| `env` | `staging` or `prod` |
| `domain` | e.g. `app.staging.example.com` |
| `slug` | kebab-case (optional; defaults to `package.json` name) |
| `action` | `provision-and-deploy` (default), `redeploy`, or `destroy` |

All credentials (DO, CF, GH, SSH, Better Uptime, Sentry) come from repo /
env secrets — Claude never asks for them.

## Trigger command Claude composes

```sh
gh workflow run deploy.yml \
  -f env=staging \
  -f domain=app.staging.example.com \
  -f slug=acme-portal \
  -f action=provision-and-deploy
```

For a redeploy of an existing env (skips provisioning, just refreshes the
stack + fires the webhook):

```sh
gh workflow run deploy.yml \
  -f env=staging -f domain=app.staging.example.com -f slug=acme-portal \
  -f action=redeploy
```

For teardown:

```sh
gh workflow run deploy.yml \
  -f env=staging -f domain=app.staging.example.com -f slug=acme-portal \
  -f action=destroy
```

## Tailing the run

Claude attempts via the GitHub MCP tools first (e.g. searching
`mcp__github__list_pull_requests` / similar workflow-run helpers if exposed
in the host); falls back to instructing the operator:

```sh
gh run watch                  # picks the most recent run in this repo
# or:
gh run view --log <run-id>
```

## What the workflow does

1. `actions/checkout@v5` (full history).
2. `.github/actions/restore-state` → fetches the orphan `deployment-state`
   branch and copies `.deploy-state.<env>.json` into the workspace.
3. `npm ci`.
4. Installs `SSH_PRIVATE_KEY` into `~/.ssh/id_ed25519`.
5. Runs `scripts/deploy.mjs --env <env> --domain <domain> [--slug <slug>] --yes`
   with the action flag mapped to `--skip-provision` or `--destroy`.
6. On success or failure, `.github/actions/persist-state` commits the
   updated state back to `deployment-state` and pushes (retried with
   2/4/8/16s backoff).

The deploy script itself is unchanged from the local-execution model —
provisioning, Cloudflare, Portainer, GitHub secrets, first webhook trigger,
health poll, Better Uptime registration. Just sourced from env vars now.

## DigitalOcean resource tagging

Every resource the script creates is tagged with
`vibe-managed=<slug>-<env>` and `vibe-resource=<type>`. If
`.deploy-state.<env>.json` is ever lost (state branch wipe), the deploy
script's `discoverFromTags()` fallback can rebuild the minimal state from
DO's tag index. See `scripts/lib/state.mjs`.

## Concurrency

`deploy.yml` declares `concurrency: { group: deploy-<env>,
cancel-in-progress: false }`. Two operators targeting the same env will
queue serially.

## Honest failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Workflow exits with "CI mode requires --yes" | The mapping in `deploy.yml` always passes `--yes`; if you see this, the workflow file was edited. | Restore `--yes` in `deploy.yml`. |
| `DO 429` | Burst rate limit | Script backs off; `redeploy` will pick up. |
| `CF zone not found` | Token scoped wrong, or apex shorter than 2 labels | Re-mint the CF token; rerun. |
| `LE challenge fails` | CF record set to proxied=true | Script sets proxied=false; re-run after toggle. |
| `Portainer init -> 409` | Admin window expired | SSH in, `docker rm -f portainer && docker volume rm portainer_data`, re-run with `action=provision-and-deploy`. |
| State branch missing the env file | First run for this env, OR branch was wiped | First run is normal. If wiped, the discover-from-tags fallback rebuilds the droplet entry; rerun with `action=redeploy`. |

## Report back

After a successful run, summarize from the workflow output:
- Deployed URL + health URL.
- Portainer admin URL + (one-time) password from the state file in logs.
- Last 3 created resources with DO/CF/GH IDs.
- Next steps: `/promote` to ship to prod, `/scaffold-entity` to add a model.

## Read before deeper changes
- `.github/workflows/deploy.yml` — the workflow
- `.github/actions/{restore-state,persist-state}` — state-branch shuttle
- `scripts/deploy.mjs` — orchestrator (unchanged from local model)
- `scripts/lib/state.mjs` — `tagResource` / `discoverFromTags`
- ADR-004 — operational model
