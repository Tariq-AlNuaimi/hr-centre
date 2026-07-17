# Operational runbooks

Checklist-driven procedures for operating a deployment of this template in
production. These are the artifact the **`sre` agent** (`.claude/agents/sre.md`)
reviews under its runbook/on-call lens, and the operational package `/handoff`
gives the IT team that takes over production (ADR-006). Decision of record:
**ADR-055**.

## The set

| Runbook                                              | Answers                                                                                                      | Owner      | Last reviewed |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------------- |
| [`restore-drill.md`](./restore-drill.md)             | Can we actually restore the database from a backup? (proof, not hope)                                        | Operator   | 2026-07-11    |
| [`deploy-rollback.md`](./deploy-rollback.md)         | This deploy is bad — how do we get back to green, and how fast?                                              | Operator   | 2026-07-11    |
| [`incident-response.md`](./incident-response.md)     | It's 3am and something paged — what do I do in the first 15 minutes?                                         | Operator   | 2026-07-11    |
| [`database-operations.md`](./database-operations.md) | How do I run a migration / touch data / handle connection exhaustion safely?                                 | Operator   | 2026-07-11    |
| [`maintainer.md`](./maintainer.md)                   | How do I evolve the harness (gates / hooks / ESLint rules / ADRs / permissions) without weakening the floor? | Maintainer | 2026-07-17    |

_The first four operate a **deployment**; `maintainer.md` operates the **template itself** (V2-505, the bus-factor floor) — a different audience (the harness maintainer, not the on-call operator)._

## How runbooks are used

- **During an incident** — open the relevant runbook and work the checklist top
  to bottom. Do not improvise the steps that are written down; a runbook exists
  precisely so you are not designing the procedure while the site is down.
- **At `/deploy`** — `deploy-rollback.md` is the pre-flight for how you would
  back out; know the rollback move _before_ you push.
- **At `/handoff`** — the whole set travels with the repo to the IT team. A
  handoff should not claim operational readiness unless the **restore drill has
  passed within the review cadence** (dated in `restore-drill.md`'s log).
- **When the `sre` agent reviews a change** — it traces the change against these
  runbooks; a change that invalidates a step (e.g. alters `vercel.json` or the
  migration convention) must update the runbook in the same diff.

## Ground truth this set assumes

- **Default deploy rail:** Vercel + Neon (ADR-006). `git push` deploys; `main` →
  production, other branches → preview URLs.
- **Self-host rail:** Docker + Caddy via `compose.prod.yaml` (ADR-030/035),
  bundled or external Postgres. `make docker-prod-up` / `make docker-prod-down`.
- **Migrations run on every build/start:** `vercel.json` `buildCommand` runs
  `prisma migrate deploy` (and a non-fatal seed) before `next build`; the
  self-host image runs migrations at container start. **Migrations must be
  small and forward-compatible** — see `database-operations.md`.
- **Health:** `GET /api/health` → `200 {status:"ok"}` or `503
{status:"degraded"}` (checks a `SELECT 1` against Postgres).
- **Audit + observability entry points:** the audit log (admin-only `GET
/api/audit-log`), OpenTelemetry spans (`lib/observability` / `withSpan`,
  ADR-040 — a no-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set), and the daily
  `CRON_SECRET`-gated audit-purge (`app/api/internal/audit-purge`, ADR-018).

## Review cadence

- **Quarterly** — walk each runbook, confirm every referenced command/file still
  exists and is correct, and re-run the **restore drill** (log the date + result
  in `restore-drill.md`). Update the "Last reviewed" column above.
- **Event-driven** — also review the affected runbook whenever a change touches
  the deploy path (`vercel.json`, `compose.prod.yaml`, `Makefile`), the migration
  convention, `lib/prisma/*`, or the backup/restore tooling. A stale runbook is
  worse than none, because it is trusted.

> A future `/runbook` skill (generate / update / validate runbooks) is a
> recorded seam in ADR-055, not yet built. Until then these are hand-maintained
> — keep the referenced commands honest.
