# ADR-040 — OpenTelemetry backbone + SigNoz (self-hostable observability)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Updates:** ADR-002 (Sentry + Better Uptime SaaS observability) — reframed for a self-hostable, swappable-backend enterprise deployment.
**Builds on:** ADR-035 (Docker-first self-host).

## Context

ADR-002 (2026-05-18) closed the "first prod incident is a learning opportunity"
gap by wiring **Sentry SaaS** for error tracking and **Better Uptime SaaS** for
uptime. That decision was right for the prototype rail: an operator with no SRE,
a single Vercel + Neon deployment, and free-tier SaaS accounts that need zero
infrastructure to run. Observability was a per-fork SaaS subscription, and that
was fine.

The enterprise pivot changes the audience. `docs/research/v2/enterprise-benchmark-v2.html`
category **C10 (observability)** sets a new bar: enterprise tenants deploy
**per-tenant** (ADR-035's Docker-first self-host rail) and often behind a
firewall or in a data-residency zone where routing telemetry to a third-party
SaaS is either a compliance violation or a hard network block. An observability
story that depends on a single hosted vendor fails the moment a tenant says "our
traces cannot leave our VPC." The backbone must be **self-hostable per tenant**
and its backend must be a **deployment choice, not a code change**.

There is also a **licensing** constraint that only bites once the template is
_redistributed_ to tenants (which ADR-035 makes routine). Several otherwise
strong self-host observability stacks — **Grafana LGTM**, **OpenObserve**, and
**Uptrace** — are **AGPL-3.0**, whose network-copyleft terms are a redistribution
concern for a template shipped into tenant environments. **SigNoz core is MIT**,
which is clean for the default path.

## Decision drivers

- **Swappable backend / no SaaS lock-in** — the telemetry sink must be a config
  choice, so a tenant can point at SigNoz, a managed APM, or their existing stack
  without touching app code.
- **Self-hostable per tenant** — runs inside the tenant's own environment
  (ADR-035), including air-gapped / residency-constrained ones.
- **License-clean for a redistributed template** — the default path must avoid
  AGPL, since the template is shipped into tenant deployments.
- **Minimal app-code coupling** — instrument once; the app emits a standard
  wire format and never knows which backend consumes it.

## Considered options

### Option 1 — OpenTelemetry backbone + SigNoz (chosen)

Instrument once with **OpenTelemetry** (`@vercel/otel` in `instrumentation.ts`),
exporting spans/metrics/logs over **OTLP** to an **OpenTelemetry Collector**
seam. The Collector fans out to a **swappable backend**, defaulting to **SigNoz**
(MIT, all-in-one traces + metrics + logs, self-hostable, ClickHouse-backed).
Error tracking keeps **Sentry** as a supported backend option, but the self-host
default routes to **GlitchTip** (Sentry-wire-compatible, self-hostable), so the
existing `lib/sentry.ts` scrub/capture conventions carry over unchanged.

- **Good:** instrument-once / swap-backend; license-clean default (MIT SigNoz +
  GlitchTip); fully self-hostable per tenant; OTLP is a vendor-neutral standard,
  so no re-instrumentation if a tenant brings their own sink.
- **Bad:** an extra service (Collector + SigNoz) to run and operate versus a
  zero-infra SaaS DSN.

### Option 2 — Sentry-only SaaS (ADR-002 as-is)

Keep per-fork Sentry SaaS as the only path.

- **Good:** zero infrastructure; already wired and tested.
- **Bad:** SaaS lock-in; fails the self-host and data-residency requirements that
  define the enterprise pivot — a non-starter for firewalled/residency tenants.

### Option 3 — Grafana LGTM stack

Loki + Grafana + Tempo + Mimir as the self-host backend.

- **Good:** powerful, mature, widely deployed.
- **Bad:** **AGPL-3.0** — a redistribution concern for a template shipped into
  tenant environments; also heavier to run (four components to operate versus
  SigNoz's single all-in-one).

## Decision

Adopt **OpenTelemetry as the instrumentation backbone** and **SigNoz as the
default self-host backend**, with **GlitchTip** (Sentry-compatible) as the
default self-host error sink and **Sentry SaaS** retained as a supported backend
option. The deciding drivers are **swappable / self-hostable** and
**license-clean**: OTLP lets us instrument the app exactly once, and the
**OpenTelemetry Collector is the seam that makes the backend a configuration
choice, not a code change** — a tenant swaps SigNoz for a managed APM (or their
own stack) by re-pointing the Collector, with zero application diff. SigNoz's MIT
license keeps the default redistribution path clean; Option 2 fails self-host and
Option 3's AGPL fails the redistribution constraint.

## Consequences

### Positive

- One instrumentation surface (`@vercel/otel` + OTLP) serves every tenant;
  changing the backend is an ops/config action, never an app-code change.
- The default self-host stack (SigNoz + GlitchTip) is MIT/OSS and license-clean
  for redistribution into tenant environments.
- Traces, metrics, and logs land in one place per tenant, inside their own
  boundary — satisfying residency and firewall constraints out of the box.
- `lib/sentry.ts` scrub/`SCRUB_FIELDS` conventions and the sentry-scrub contract
  test carry forward: GlitchTip speaks the Sentry wire format, so PII scrubbing
  is unchanged.

### Negative

- Self-host tenants run more infrastructure (Collector + SigNoz + ClickHouse)
  than a single SaaS DSN required.
- Two telemetry paths to keep coherent (OTLP traces/metrics/logs via the
  Collector, plus Sentry-format errors) rather than one Sentry SDK.

### Mitigations

- **The Collector is optional.** A single-tenant fork can point OTLP straight at
  a SigNoz instance (or a managed OTLP endpoint) with no Collector in the path;
  the Collector is only needed when a tenant wants fan-out or backend swapping.
- **Vercel-hosted prototype forks are unchanged.** They keep the ADR-002 path —
  Sentry SaaS + Vercel Speed Insights — since they never self-host and the
  license/residency constraints don't apply to them. The OTel backbone is the
  enterprise/self-host default, not a forced migration for prototypes.
- SigNoz + GlitchTip ship as Docker services (ADR-035), so a tenant brings the
  stack up with the same compose workflow as the app.

## Alternatives considered

- **Sentry-only SaaS (ADR-002 as-is):** rejected — SaaS lock-in fails self-host + residency.
- **Grafana LGTM stack:** rejected — AGPL-3.0 redistribution concern + heavier to operate.
- **OpenObserve / Uptrace as the backend:** rejected for the same AGPL-3.0 redistribution concern as LGTM.
- **Datadog / New Relic managed:** rejected — per-seat pricing + vendor lock-in, and cannot satisfy air-gapped tenants.

## Migration triggers

- Revisit the backend if trace volume outgrows **SigNoz single-node** — move to a
  ClickHouse-backed scale-out deployment or a managed SigNoz/OTLP tier.
- Reconsider the default if a tenant **standardizes on a specific APM** (e.g. they
  already run Datadog/Honeycomb) — re-point the Collector to their sink rather
  than running SigNoz alongside it.
- Revisit if `@vercel/otel` drops Next.js support before the template upgrades
  Next, or if the OTLP contract changes materially.

## Related

- ADR-002 — Sentry + Better Uptime SaaS observability (the decision this reframes).
- ADR-035 — Docker-first self-host (the per-tenant deployment model this serves).
- `docs/research/v2/10-observability.md` — enterprise observability benchmark detail.
