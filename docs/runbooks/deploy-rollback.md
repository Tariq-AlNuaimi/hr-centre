# Runbook — Deploy & rollback

**Purpose:** get a bad deploy back to green fast, on either rail. Know the
rollback move _before_ you push (this is `/deploy` pre-flight). Decision of
record: **ADR-055**.

> **The migration caveat that governs every rollback here:** `vercel.json`'s
> `buildCommand` runs `prisma migrate deploy` **on every build**, and the
> self-host image runs migrations at container start. Reverting the _code_ does
> **not** revert the _schema_. So a migration must be **forward-compatible** —
> never drop or rename a column the running (previous) version still reads.
> Rolling back code onto a schema the old code cannot read is a second outage.
> See `database-operations.md` for the expand/contract discipline that makes
> rollback safe.

## First: is this a code problem or a migration problem?

- **Code-only regression** (bug, bad UI, wrong logic; schema unchanged) →
  rolling back the deploy fully fixes it. Proceed below.
- **Migration involved** (the deploy shipped a schema change) → rolling back code
  is **not** automatically safe. Confirm the migration was additive/forward-
  compatible. If it dropped/renamed/tightened a column the previous version
  reads, a plain code rollback will error against the new schema — you must
  roll _forward_ with a fix, or restore the DB (`restore-drill.md`). Decide this
  first; it changes the whole procedure.

---

## Rail A — Vercel (default, ADR-006)

Every push is a deploy: `main` → production, other branches → preview URLs.
Vercel keeps every prior deployment.

**Instant rollback (fastest — no rebuild):**

1. Vercel dashboard → the project → **Deployments**.
2. Find the last known-good production deployment (before the bad one).
3. **⋯ → Promote to Production** (a.k.a. Instant Rollback). Traffic shifts to
   that immutable build in seconds — no rebuild, no migration re-run.
4. Verify: `curl -fsS https://<prod-url>/api/health` → `{"status":"ok"}`; spot-
   check the regressed flow in a browser.
5. **Then fix forward in git** so the next push is clean (the promoted old build
   is a stopgap, not the source of truth — `main` still has the bad commit).

**Git revert (when you want the code state to match too):**

1. `git revert <bad-sha>` on a branch → `/ship` (must be green) → open PR /
   push to `main`. Vercel rebuilds and redeploys.
2. Slower (full rebuild + `prisma migrate deploy` re-runs) but leaves `main`
   correct. **Do not `git revert` a migration commit** without first confirming
   the down-direction is safe — reverting the code does not un-apply the
   migration, and a revert PR will just re-run `migrate deploy` (a no-op for an
   already-applied migration). Fix the schema forward instead.

> Never force-push or hard-reset `main` to "undo" a deploy — destructive git is
> deny-listed and it breaks other clones. Use Promote-to-Production or revert.

---

## Rail B — Self-host Docker + Caddy (ADR-030/035)

The image is a mandatory build artifact (`make docker-build`); production self-
host runs `compose.prod.yaml` (Caddy TLS + app + bundled/external Postgres),
migrations at container start.

**Roll back to the previous image tag (fastest):**

1. Identify the last-good image tag (you tag per release:
   `make docker-build IMAGE=myrepo/app:<prev>`).
2. Point the compose file / env at the previous tag and:
   `make docker-prod-down` then `make docker-prod-up` (or
   `docker compose -f compose.prod.yaml --profile <db-profile> up -d` with the
   old tag). Caddy re-fronts the rolled-back app.
3. **Migration caveat applies harder here:** the old image runs `prisma migrate
deploy` at start too. If the new release added a forward-compatible migration,
   the old image is fine (it ignores the new column). If the migration was
   _not_ forward-compatible, the old image will fail its startup migration or its
   queries — you must roll forward or restore (`restore-drill.md`).
4. Verify: `curl -fsS https://<host>/api/health` → `{"status":"ok"}`; check
   `docker compose -f compose.prod.yaml logs app` for a clean start.

---

## Pre-flight checklist (run before any production deploy)

- [ ] `/ship` is green (typecheck + lint + tests + build + secret scan + audit).
- [ ] If the diff includes a migration: it is **additive / forward-compatible**
      (no dropped/renamed/narrowed column the current prod version reads).
- [ ] I know the **last-good** deployment (Vercel) or **image tag** (Docker) to
      roll back to.
- [ ] I know whether a rollback is code-only (safe) or migration-involving
      (roll forward / restore instead).
- [ ] `/api/health` is green pre-deploy (so a post-deploy 503 is attributable).

## Post-rollback checklist

- [ ] `/api/health` → `{"status":"ok"}`.
- [ ] The specific regressed flow is verified fixed in a browser.
- [ ] The audit log (`GET /api/audit-log`, admin) shows no anomalous writes
      during the bad window.
- [ ] `main` (or the release tag) is reconciled with a fix-forward — the rollback
      is not left as the only record of correctness.
- [ ] Incident logged per `incident-response.md` if there was user impact.
