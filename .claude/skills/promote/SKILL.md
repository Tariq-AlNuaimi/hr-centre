---
name: promote
description: Promote a staging commit to production. Executes via the `promote.yml` GitHub Actions workflow (ADR-004). Verifies staging CI green on the SHA, tags `prod-YYYYMMDD-HHmm`, triggers the prod stack's Portainer webhook, polls prod health. Use when the user says "ship it", "promote to prod", "deploy to production", "/promote".
---

# /promote — Staging → Production (CI-driven)

Triggers the `promote.yml` workflow. Both `staging` and `prod` must already be
provisioned (their state files exist on the `deployment-state` branch).

> **Executes via GH Actions workflow.** Claude proposes inputs; operator
> dispatches; CI runs `scripts/promote.mjs`. See ADR-004.

## Claude's job

1. Collect the SHA (or default `HEAD`) and the slug from the operator.
2. Compose the `gh workflow run promote.yml` command.
3. Tail the run (MCP if available, else `gh run watch`).
4. If the workflow tags `prod-*`, the push trigger on `release.yml` will
   auto-draft the CHANGELOG entry and create the GitHub release. Mention
   this to the operator so they know `/release` may not need to be invoked
   separately.

## Inputs

| Input | Default | Notes |
|---|---|---|
| `slug` | `package.json` name | kebab-case |
| `sha` | `HEAD` | 7+ char SHA, or `HEAD` to grab the latest main |

## Trigger command Claude composes

```sh
gh workflow run promote.yml \
  -f slug=acme-portal \
  -f sha=HEAD          # or a specific SHA like abc1234
```

## What the workflow does

1. Checks out the repo, fetches `deployment-state` and restores both
   `.deploy-state.staging.json` and `.deploy-state.prod.json`.
2. Runs `scripts/promote.mjs --sha <sha> [--slug <slug>] --yes`:
   - Verifies the most recent `docker-build.yml` run for the SHA on `main`
     concluded `success`. Aborts otherwise.
   - Tags `prod-YYYYMMDDTHHmm` pointing at the SHA. Pushing the tag triggers
     `release.yml` automatically.
   - Triggers the prod Portainer stack webhook with `?IMAGE_TAG=sha-<short>`.
   - Polls `https://<prod-domain>/api/health` for up to 3 min.
3. Persists prod state back to `deployment-state`.

## Concurrency

`concurrency: { group: promote-prod, cancel-in-progress: false }`. Two
promotes serialize.

## Refusal cases

- Staging build for the SHA was not `success` → workflow exits non-zero.
- `.deploy-state.prod.json` lacks a webhook URL → workflow exits; operator
  runs `/deploy --env prod` first.
- No staging deploy of this SHA → script warns but continues if the image
  exists in GHCR.

## Report back

- The tag pushed (`prod-...`).
- The SHA promoted.
- The prod URL + health status.
- Rollback hint: `gh workflow run rollback.yml -f env=prod -f to_sha=<prev-sha>`.
- Note: `release.yml` triggers on the tag push; no separate `/release` needed
  unless the operator wants to re-draft an existing tag's notes.

## Read before
- `.github/workflows/promote.yml`
- `scripts/promote.mjs`
- ADR-003 (release process — `release.yml` is the downstream consumer of the
  tag push).
- ADR-004 (operational model).
