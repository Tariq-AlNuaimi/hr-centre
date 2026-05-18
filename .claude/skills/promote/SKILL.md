---
name: promote
description: Promote a staging commit to production. Verifies the build is green on staging, tags `prod-YYYYMMDD-HHmm`, triggers the prod stack's Portainer webhook with the SHA, and polls prod health. Use when the user says "ship it", "promote to prod", "deploy to production", "/promote", or wraps up staging work.
---

# /promote — Staging → Production

Promotes a specific commit from staging to production. Both environments must already be provisioned via `/deploy --env staging` and `/deploy --env prod` (so their state files exist).

## Inputs

| Flag | Default | Notes |
|---|---|---|
| `--sha` | required | 7+ char SHA, or `HEAD` to grab the latest main |
| `--gh-token` | required | PAT with `repo` + `workflow` |
| `--yes` | false | confirm; script aborts otherwise |

## Steps

1. **Verify staging CI green** for the SHA: looks up the most recent `docker-build.yml` run on `main` and ensures conclusion was `success`. Aborts if not.
2. **Tag** the SHA as `prod-YYYYMMDDTHHmm` (UTC). Provides a clean rollback target.
3. **Trigger** the prod Portainer stack webhook with `?IMAGE_TAG=sha-<short>` (T-04 SHA pinning).
4. **Poll** `https://<prod-domain>/api/health` for up to 3 minutes.

## Refusal cases

- Staging build for the SHA was not `success` → aborts with the conclusion string.
- Prod state file doesn't have a `webhookUrl` → aborts; operator runs `/deploy --env prod` first.
- No prior staging deploy of this SHA → warns but does not abort (the image may have been built by docker-build.yml even without a staging deploy).

## Usage

```
npm run promote -- --sha HEAD --gh-token ghp_... --yes
# or pin to a specific known-good commit:
npm run promote -- --sha abc1234 --gh-token ghp_... --yes
```

## Report back

- The tag pushed (`prod-...`)
- The SHA promoted
- The prod URL + health status
- A "rollback hint": `npm run rollback -- --env prod --to sha-<prev-short>`
