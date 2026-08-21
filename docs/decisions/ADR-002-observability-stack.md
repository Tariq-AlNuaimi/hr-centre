# ADR-002 — Observability stack: Sentry SaaS + Better Uptime SaaS

> **PARTIALLY SUPERSEDED** — by [ADR-006](ADR-006-pivot-to-vercel-neon.md) (the Better-Uptime / self-hosted `/deploy` ops half) and reframed by [ADR-040](ADR-040-otel-observability-backbone.md) (an OpenTelemetry backbone + SigNoz replaces the SaaS-only posture for self-host forks). The Sentry half remains Accepted.

**Status:** Accepted (Sentry half); **Better-Uptime / `/deploy` integration partially superseded by ADR-006**
**Date:** 2026-05-18
**Decision owner:** Tariq AlNuaimi
**Reviewers:** —

> **2026-05-21 — ADR-006 superseded the self-hosted ops half of this ADR.** The
> Sentry wiring is live and accurate (`instrumentation.ts`, `instrumentation-client.ts`,
> `lib/sentry.ts`, `tests/contracts/sentry-scrub.test.ts`). But the **Better Uptime**
> auto-registration, the `scripts/lib/better-uptime.mjs` helper, the `docker-build.yml`
> source-map step, and the "`/deploy` registers a monitor" / `first-fork` step 12
> claims below describe the deleted DigitalOcean/Portainer ops surface — they do **not**
> exist on the Vercel + Neon rail. Uptime is now an optional `/scale-up` add-on. Treat
> the Better-Uptime sections as historical.

## Context

The template ships to projects that operate without dedicated SRE. Before this ADR, the first production failure was silent — no error tracking, no uptime alert. `SECURITY.md` §10 row A09 already flagged this as a gap (no Sentry / Prometheus wired).

Two real failure modes set the bar:

1. A 500 in a server component goes unreported. The operator notices only when a user mentions it the next day. Repro requires reading container logs, which Portainer rotates after a few days.
2. A Droplet OOMs and Caddy can't reach the app. No monitor pages anyone. The on-call effectively starts when a customer calls.

Per-project Sentry SaaS + Better Uptime SaaS was chosen over self-hosted GlitchTip + Uptime Kuma after weighing operational burden, alert deliverability, and the failure mode where the same Droplet hosts the app _and_ its monitor.

## Decision

- **Sentry SaaS for error tracking.** Per-project Sentry project (operator creates manually first time via `/first-fork`, captures DSN). `@sentry/nextjs` instrumentation in the template:
  - `instrumentation.ts` + `instrumentation-client.ts` at repo root (Next 16 convention).
  - `lib/sentry.ts` exports `captureError` (scrubs context via the same `SCRUB_FIELDS` set as `lib/prisma/audit-extension.ts`) and `setUserContext` (id only, no PII).
  - `withAuth` in `lib/api-helpers.ts` sets the user-id scope on every authed request.
  - `next.config.ts` wraps with `withSentryConfig`. Source-map upload is gated on `SENTRY_AUTH_TOKEN`; local + first-fork builds work without it.
- **Better Uptime / Better Stack SaaS for uptime.** Monitor auto-registered by `/deploy` against `/api/health` of each env. Per-project API key (`BETTER_UPTIME_API_KEY`). Idempotent: re-runs reuse the existing monitor; `--destroy` removes it.
- Both integrations are **opt-in**. Forks that skip them deploy without observability — only warnings, never failures.

## Consequences

### Positive

- First prod incident becomes a routine signal, not a learning opportunity.
- Sentry DSN, user-id scope, scrub list, and instrumentation conventions are inherited by every fork — no per-project plumbing.
- Better Uptime monitor lifecycle is tied to `/deploy` state file, so teardown is automatic.

### Negative

- Two more external accounts per fork (operator-side; both free tiers cover the expected scale).
- Two new Restricted secrets: `SENTRY_AUTH_TOKEN` (CI source-map upload) and `BETTER_UPTIME_API_KEY` (per-deploy registration). `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are **not** Restricted — DSNs are public-by-design per Sentry's own docs and ship in the JS bundle by intention.
- One more dep in `package.json` (`@sentry/nextjs` 10.x, ~2 MB minified + sourcemap upload tooling). Pin exact version to avoid surprise major bumps.

### Mitigations

- Source-map upload in `docker-build.yml` is `continue-on-error: true` and gated on both the auth token secret AND the org/project repo vars being set. Early forks deploy before configuring Sentry; upload step skips silently.
- `lib/sentry.ts` imports `SCRUB_FIELDS` from the audit extension rather than duplicating, so a future Restricted field added to the audit set is automatically scrubbed from Sentry contexts too. The contract test `tests/contracts/sentry-scrub.test.ts` asserts this on every push.
- `setUserContext` ships only the user id. Email / name / role would be Confidential per SECURITY.md §1; a future Sentry breach cannot leak operator PII via this path.

## Alternatives considered

1. **GlitchTip self-hosted.** Same Droplet as the app → can't catch host failures (the failure mode that motivates a monitor). Separate Droplet → doubles cost ($24/mo per fork) for a feature already free at Sentry's tier.
2. **Uptime Kuma self-hosted.** Same problem as GlitchTip — co-hosting with the monitored app is a fundamental failure mode. Separate host → again, doubled cost.
3. **No observability (status quo).** Rejected because the first prod incident becomes a learning opportunity instead of a routine signal — and the gap is already flagged in SECURITY.md A09.
4. **Datadog / New Relic.** Rejected: $15+/user/mo, vendor lock-in, more surface area than the template's audience needs.
5. **Self-host Loki / Promtail for logs.** Out of scope for this ADR (log aggregation is a separate gap; this one closes error tracking + uptime).

## Migration triggers

- If a project hits 5k errors/mo (Sentry free tier ceiling), revisit pricing tier or self-host.
- If Better Uptime free tier (10 monitors) is exhausted across forks, revisit.
- If a Tier-3 data class lands in a fork and a "Sentry could see user-namespaced PII" risk emerges, tighten `captureError` further (e.g. allowlist context keys instead of denylist).
- If `@sentry/nextjs` drops Next.js 16 support before the template upgrades Next, pin Sentry to the highest version that still lists Next 16 in `peerDependencies` and document here.

## Related

- `lib/sentry.ts` — wrapper + scrub
- `instrumentation.ts`, `instrumentation-client.ts`, `next.config.ts` — wiring
- `lib/prisma/audit-extension.ts` `SCRUB_FIELDS` — shared scrub set
- `scripts/lib/better-uptime.mjs` — uptime API client
- `scripts/deploy.mjs` — uptime registration + Sentry env passthrough
- `.github/workflows/docker-build.yml` — source-map upload step
- `tests/contracts/sentry-scrub.test.ts` — contract test
- `SECURITY.md` §6, §10 — secret classification + OWASP A09 row
- `.claude/skills/first-fork/SKILL.md` step 12 — operator onboarding
