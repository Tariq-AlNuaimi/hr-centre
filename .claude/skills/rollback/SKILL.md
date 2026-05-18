---
name: rollback
description: Flip a Portainer stack's IMAGE_TAG to a previous SHA and trigger redeploy. Pure image swap; doesn't touch the DB. Use when the user says "rollback", "revert prod", "the latest deploy is broken", "/rollback", or wants to retreat to a known-good commit. Re-uses the T-04 SHA-pinning pattern.
---

# /rollback — Flip the image tag, redeploy

~30 seconds end-to-end. The stack webhook honors `IMAGE_TAG=sha-<short>` (T-04 SHA pinning), so rollback is just a webhook call with an older tag.

## Inputs

| Flag | Notes |
|---|---|
| `--env` | `staging` or `prod` (default `prod`) |
| `--to <sha-tag>` | e.g. `sha-abc1234`. Or `latest` to roll forward. |
| `--list-recent` | Print the last 10 main builds with their SHAs |
| `--gh-token` | Needed for `--list-recent` |

## Steps

1. (Optional) `npm run rollback -- --list-recent --env prod --gh-token ghp_...` to see the SHA list.
2. `npm run rollback -- --env prod --to sha-<short> --yes` — fires the webhook.
3. `curl https://<env>/api/health` after ~30s.

## What this does NOT do

- **Does not roll back database migrations.** If the failing deploy ran a destructive migration, rollback alone won't restore the schema. Use `/restore` for DB-level recovery, then `/rollback`.
- **Does not change the git default branch.** `main` continues to point at the latest commit. Operators wanting to undo on a code level should `git revert` separately.

## Confirmation gate

The script requires `--yes` for prod (refuses otherwise) and prints the current vs. target SHA before firing.

## Read before
- `scripts/rollback.mjs`
- `SECURITY.md` T-04 (image-tag pinning)
- `docker-compose.prod.yml` (the `IMAGE_TAG:-latest` resolution)
