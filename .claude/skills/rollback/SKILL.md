---
name: rollback
description: Flip a Portainer stack's IMAGE_TAG to a previous SHA. Pure image swap; doesn't touch the DB. Executes via the `rollback.yml` GitHub Actions workflow (ADR-004). Use when the user says "rollback", "revert prod", "the latest deploy is broken", "/rollback".
---

# /rollback — CI-driven image-tag flip

~30 seconds end-to-end. The stack webhook honors `IMAGE_TAG=sha-<short>`
(T-04 SHA pinning), so rollback is one webhook call.

> **Executes via GH Actions workflow.** Claude composes inputs; operator
> dispatches `rollback.yml`. See ADR-004.

## Claude's job

1. Ask the operator which env and which target SHA.
2. (Optional) Help find a known-good SHA via:
   ```sh
   gh run list --workflow=docker-build.yml --branch=main --limit=10 \
     --json conclusion,displayTitle,headSha,createdAt
   ```
3. Compose the workflow trigger.
4. Tail and report.

## Inputs

| Input | Notes |
|---|---|
| `env` | `staging` or `prod` |
| `slug` | optional; defaults to `package.json` name |
| `to_sha` | target SHA: `abc1234`, `sha-abc1234`, or `latest` to roll forward |

## Trigger command Claude composes

```sh
gh workflow run rollback.yml \
  -f env=prod \
  -f slug=acme-portal \
  -f to_sha=sha-abc1234
```

## What the workflow does

1. Restores `.deploy-state.<env>.json` from the state branch.
2. Runs `scripts/rollback.mjs --env <env> --to <sha> --yes`.
3. Script normalizes `--to abc1234` to `sha-abc1234`, fires the Portainer
   stack webhook with `?IMAGE_TAG=sha-abc1234`.
4. Operator verifies with `curl https://<env-domain>/api/health`.

## What this does NOT do

- **Database migrations.** If the failing deploy ran a destructive
  migration, rollback alone won't restore the schema. Use `/restore` for DB
  recovery, then `/rollback`.
- **Change git default branch.** `main` continues to point at the latest
  commit. Use `git revert` separately for code-level reversion.

## Concurrency

`concurrency: { group: rollback-<env>, cancel-in-progress: false }`.

## Read before
- `.github/workflows/rollback.yml`
- `scripts/rollback.mjs`
- SECURITY.md T-04 (image-tag pinning)
- ADR-004
