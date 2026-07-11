# ADR-018 — Audit-log retention via Vercel Cron

**Status:** Accepted
**Date:** 2026-06-12
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-006 (pivot to Vercel + Neon), ADR-010 (audit completeness), SECURITY.md §audit

## Context

The audit extension writes a row for every create/update/delete — that is the point
(ADR-010). But nothing ever deleted old rows: the monthly Actions retention workflow was
removed in ADR-006, and `/api/internal/audit-purge` shipped dormant with a comment
deferring retention to the IT team post-handoff. For `personal`-tier forks that never
hand off, `audit_logs` grew unbounded — a slow leak against Neon's free 500 MB and
against query performance on the audit-log screen.

Vercel Cron (free on Hobby, daily granularity) can call the endpoint, but it can only
send `GET` with `Authorization: Bearer $CRON_SECRET` — it cannot send the custom
`x-internal-token` header `withInternalAuth` required.

## Decision

Wire retention by default, dormant until a secret is set (operator approved 2026-06-12):

- **`withInternalAuth` gains opt-in Bearer support:** `{ bearer: true }` makes the
  route also accept `Authorization: Bearer <secret>` (strict `Bearer ` prefix, token
  trimmed, shared parser with `withApiAuth`). The option is per-route — the Bearer
  surface is NOT widened on other internal endpoints. `x-internal-token`, when present,
  is authoritative — a wrong value is not rescued by a correct Bearer header. Covered
  by contract tests (accept-with-opt-in, reject-without, reject-bare-Authorization,
  precedence).
- **`withInternalAuth` gains `{ skipWhenUnconfigured: true }`:** unset env var → 200
  `{skipped:true}` instead of 503, so an unconfigured fork's daily cron logs healthy
  no-ops, not a permanent red-failure streak (alarm fatigue).
- **`/api/internal/audit-purge` exports `GET`** gated on `CRON_SECRET` (the var Vercel
  auto-injects into cron requests) with both options, alongside the existing `POST`
  (gated on `AUDIT_PURGE_TOKEN` for manual/Actions callers). Both compose
  `withRateLimit` (5/min/IP) and both secrets carry a zod `min(32)` floor in
  `lib/env.ts`. The purge deletes in capped batches (10k rows/statement, parameterized
  raw SQL, `maxDuration: 60`) so a huge first backlog commits incremental progress
  instead of timing out and rolling back daily.
- **`vercel.json` ships a daily cron** (`0 3 * * *`) hitting the GET path, and
  **`scripts/deploy.mjs` provisions a generated `CRON_SECRET`** so `/deploy`-created
  forks get active retention out of the box. Retention window stays
  `AUDIT_RETENTION_DAYS` (default 365).

## Consequences

### Positive

- Every fork gets bounded audit growth by setting ONE env var — no code, no workflow.
- The internal-auth wrapper now works with any Bearer-only scheduler, not just Vercel.

### Negative

- A second accepted credential presentation on the routes that opt in (same secret
  strength, but two header forms to reason about there).

### Mitigations

- Constant-time comparison for both forms; precedence rule tested; ESLint
  `no-bare-internal-route` still forces the wrapper on every internal route.

## Alternatives considered

1. **Keep dormant per ADR-006** — acceptable for `shared` tier (IT owns retention), but
   `personal` forks never hand off, so "later" meant "never".
2. **Neon-side retention (pg_cron / scheduled query)** — couples retention to the DB
   provider and hides app-level behavior from the repo; Neon free tier lacks pg_cron.
3. **A separate public cron route without the wrapper** — rejected outright; violates
   the security floor (`no-bare-internal-route`).

## Migration triggers

- If Vercel Cron limits change or a fork moves off Vercel, fall back to the POST path
  from any scheduler that can send custom headers.

## Related

- `lib/api-helpers.ts` (`withInternalAuth`), `app/api/internal/audit-purge/route.ts`,
  `vercel.json`, `tests/contracts/api-auth.test.ts`.
