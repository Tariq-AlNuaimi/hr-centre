# Runbook — Incident response

**Purpose:** a repeatable first response so a production incident is worked, not
improvised. Optimized for the operator-plus-Claude workflow and a later IT-team
handoff (ADR-006). Decision of record: **ADR-055**.

## Severity levels

| Sev       | Definition                                    | Examples                                                           | Response                                                                   |
| --------- | --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **SEV-1** | Full outage or data-loss / data-exposure risk | `/api/health` 503 sustained; DB down; secret leaked; auth bypass   | Drop everything; roll back or restore now; notify stakeholders immediately |
| **SEV-2** | Major feature broken, no safe workaround      | A core CRUD flow errors for all users; a role's whole surface 500s | Roll back the offending deploy; fix forward same-day                       |
| **SEV-3** | Degraded / partial, workaround exists         | Slow queries; one non-critical route failing; elevated error rate  | Investigate in-hours; schedule the fix                                     |
| **SEV-4** | Cosmetic / low-impact                         | UI glitch, copy error, minor a11y                                  | Normal backlog                                                             |

When unsure, **round up** — treat data-loss/exposure risk as SEV-1 regardless of
current blast radius.

## First 15 minutes (work top to bottom)

1. **Confirm it's real (2 min).**
   `curl -fsS https://<prod-url>/api/health` — `{"status":"ok"}` (200) vs
   `{"status":"degraded"}` (503, DB check failed). Reproduce the reported
   symptom yourself in a browser. A green health check + no repro → likely
   SEV-3/4 or client-side; a 503 → DB/infra, likely SEV-1.
2. **Set severity (1 min)** from the table above. Start a timestamped note (what
   you saw, when) — this becomes the incident record.
3. **Find the trigger — what changed? (3 min).** Almost every incident follows a
   deploy or a schedule:
   - **Recent deploy?** Vercel → Deployments (or the running Docker image tag).
     If the incident started right after a deploy, treat that deploy as the
     cause until proven otherwise → go to `deploy-rollback.md`.
   - **Recent migration?** Check whether the last deploy shipped a schema change
     (`prisma migrate status`) — a non-forward-compatible migration is a common
     cause and changes the rollback path (see `deploy-rollback.md`).
   - **Provider status?** Check Vercel / Neon status pages for a platform event.
4. **Stop the bleeding (5 min).** Prefer the fastest reversible move:
   - Bad deploy → **Promote last-good to Production** (Vercel) or roll to the
     previous image tag (Docker). See `deploy-rollback.md`.
   - DB unreachable / corrupt → `restore-drill.md` (you rehearsed this).
   - Flood / abuse → the routes are rate-limited (`withRateLimit`, in-memory
     per-instance); confirm limits are engaging; multi-instance abuse →
     distributed limiter via `/scale-up` (Upstash).
5. **Verify recovery (2 min).** `/api/health` green; the specific flow works;
   error rate falling. If not recovered, escalate severity and widen the fix.
6. **Communicate (ongoing).** See below.

## Communications

- **SEV-1/2:** notify the stakeholders sharing the URL (and, post-handoff, the IT
  team owning production) _immediately_ with: what's broken, blast radius, what
  you're doing, next update time. Then update on that cadence until resolved.
- **Be honest about state** — no "all good" until `/api/health` is green _and_
  the flow is verified. The template's own doctrine ("no green toast over a
  failure") applies to incident comms too.
- **SEV-3/4:** a note in the tracker is enough; no interrupt.

## Observability & audit entry points (where to look)

- **Health:** `GET /api/health` — DB reachability (`SELECT 1`); 200 vs 503.
- **Request logs:** Vercel → the project → **Logs** (functions/runtime), or
  `docker compose -f compose.prod.yaml logs app` on self-host. Logs are
  structured and **metadata-only** — no secrets/PII by rule (`lib/email.ts` logs
  metadata not bodies; `no-secret-env-in-console`). If you can't see a value in
  a log, that is by design, not a gap.
- **Tracing:** OpenTelemetry spans via `lib/observability` / `withSpan`
  (ADR-040) — a **no-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set**. If tracing
  is dark during an incident, the spans are placed but no collector is wired;
  the self-host `observability` compose profile stands one up
  (`--profile observability`, OTLP on :4318).
- **Audit log:** admin-only `GET /api/audit-log` — who-did-what across every
  audited create/update/delete (`auditExtension`). Use it to answer "did a bad
  actor / bad deploy write anything during the window?" Restricted fields are
  scrubbed in the log by design.
- **Scheduled jobs:** the daily audit-purge cron (`app/api/internal/audit-purge`,
  3am, `CRON_SECRET`-gated, ADR-018) is a bounded/batched delete; a failure
  there is SEV-3 (retention drift), not user-facing.

## After the incident

- [ ] `/api/health` green and the flow verified by a real user path.
- [ ] Incident note completed: timeline, severity, trigger, fix, blast radius.
- [ ] `main` reconciled with a fix-forward (a rollback is a stopgap, not a fix).
- [ ] Root cause + prevention captured — durable lessons go to
      `docs/agent-memory.md` via `/remember` so the next session/fork inherits
      them; any accepted residual risk logged in `docs/findings-register.md`.
- [ ] If a runbook step was wrong or missing, fix the runbook (that is the
      cheapest possible post-incident action).
