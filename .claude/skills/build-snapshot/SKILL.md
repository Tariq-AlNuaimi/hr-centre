---
name: build-snapshot
description: Pre-bake a custom DigitalOcean snapshot with Docker + Caddy + age + rclone pre-installed so every subsequent /deploy boots from it and skips the ~4 min apt-install phase. One-time setup per DO region; recoups ~3-5 min on every /deploy. Use when the user says "speed up deploys", "build base image", "build snapshot", "make deploys faster", or "/build-snapshot".
---

# /build-snapshot — Pre-bake a base Droplet image

Cuts staging deploy time from ~10-15 min down to ~3-5 min by pre-installing Docker, Caddy, age, rclone, and pre-pulling the Docker base images (`postgres:17-alpine`, `minio/minio:<pinned>`, `node:24-alpine`, etc.) into a DigitalOcean snapshot. Future `/deploy` runs use that snapshot as the droplet image instead of stock Ubuntu and skip the apt-install phase entirely.

**Run this once per DO region during `/first-fork`** (or after a security-update refresh).

## When NOT to run

- You've already built a snapshot for this region in the last ~3 months and don't care about base-package security updates (the workflow is idempotent — it'll just print "already exists" and exit fast). To force a refresh, dispatch with `force_rebuild=true`.
- You're targeting a region with no snapshot in place but want the *first* deploy to still work — `/deploy` falls back to stock Ubuntu cloud-init if `DO_BASE_SNAPSHOT_ID_<REGION>` is unset. You can build the snapshot later.

## Inputs

| Input | Notes |
|---|---|
| `region` | DO region slug (`fra1`, `ams3`, `nyc3`, `sfo3`, `sgp1`, `blr1`, `syd1`, `lon1`, `tor1`). Snapshots are region-locked — build a separate one for each region you deploy to. |
| `force_rebuild` | Destroy and rebuild even if a snapshot already exists. Use after Docker / Caddy / Ubuntu security updates. Default `false`. |

## Trigger command

```sh
gh workflow run build-snapshot.yml -f region=fra1
```

For a forced refresh (e.g. quarterly):

```sh
gh workflow run build-snapshot.yml -f region=fra1 -f force_rebuild=true
```

## What it does

1. Validates `DO_API_TOKEN`, `GH_AUTOMATION_TOKEN`, `SSH_PRIVATE_KEY`, `SSH_PUBKEY`.
2. Checks for an existing snapshot named `vibe-base-<region>`. If found and `force_rebuild=false`, just re-sets the repo variable and exits in ~5s.
3. Creates a temp `s-1vcpu-2gb` droplet from stock Ubuntu 22.04 with `deploy/cloud-init-base.yml` as user-data — installs Docker + Caddy + age + rclone + pre-pulls base Docker images, then powers off.
4. Polls until the droplet status is `off`.
5. Calls `POST /droplets/<id>/actions {type: snapshot}` and polls the action until complete (~3-6 min).
6. Reads the new snapshot's ID and writes it to repo variable `DO_BASE_SNAPSHOT_ID_<REGION>` (e.g. `DO_BASE_SNAPSHOT_ID_FRA1`).
7. Destroys the temp droplet.

Total runtime: **~6-9 min one-time per region**.

## How /deploy consumes it

`scripts/deploy.mjs` reads `DO_BASE_SNAPSHOT_ID_<REGION>` from env (passed by `deploy.yml`'s env block). If set, it passes the snapshot ID as the `image` to `DO.createDroplet` and renders a slim cloud-init that skips the apt-install runcmd lines.

**If the variable is unset**, deploy.mjs falls back to stock Ubuntu 22.04 + the full cloud-init. No regression.

## Cost

- Temp droplet during build: ~$0.02 (8-10 min of `s-1vcpu-2gb` at $0.018/hr)
- Snapshot storage: **~$0.20/mo** per region ($0.06/GB/mo × ~3-4 GB snapshot)
- Net: a few cents to build + ~$0.20/mo ongoing, in exchange for ~3-5 min saved per `/deploy`.

## Concurrency

`concurrency: { group: build-snapshot-<region>, cancel-in-progress: false }` — two operators triggering for the same region queue serially. Different regions run in parallel.

## Honest failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `droplet did not reach status="off" in 720000ms` | apt install hung; rare but possible on a bad apt mirror | Re-run; transient. If it repeats, check DO console for the droplet's serial console output. |
| `action errored` after `createSnapshot` | DO snapshot subsystem hiccup | Re-run with `force_rebuild=true` to clean up the failed snapshot and retry. |
| Snapshot built but `/deploy` doesn't use it | `DO_BASE_SNAPSHOT_ID_<REGION>` variable not set, or deploy.yml not passing it through env | Check repo Settings → Variables for the exact name (case-sensitive). Confirm `deploy.yml` env block references it. |
| `DO Spaces / billing limit hit` | Free-tier DO accounts cap snapshots at 5 | Destroy older snapshots in DO console → Images → Snapshots. |

## Read before deeper changes

- `scripts/build-snapshot.mjs` — orchestrator
- `deploy/cloud-init-base.yml` — what gets pre-installed
- `scripts/lib/do.mjs` — snapshot APIs (`createSnapshot`, `waitForDropletActionComplete`, `findSnapshotByName`)
- `scripts/deploy.mjs` — how the snapshot ID is consumed (the `image` param to `DO.createDroplet`)
