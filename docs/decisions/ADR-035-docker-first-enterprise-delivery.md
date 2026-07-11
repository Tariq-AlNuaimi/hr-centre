# ADR-035 — Docker-first enterprise delivery (self-host, deploy-per-tenant)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** ADR-006 (Vercel + Neon as the *deploy default*) — demoted from
default to an opt-in prototype/preview option; the Vercel build path itself is
retained.
**Reframes:** ADR-030 (Docker was a build artifact atop a Vercel deploy → the
Docker image is now the primary delivery rail); ADR-011 (tenancy-by-deployment
now = one dockerized deployment per tenant, not one Vercel+Neon project).
**Builds on:** ADR-023 (the multi-stage Dockerfile / compose / Make-target
implementation, kept).

## Context

The enterprise pivot — source of truth `docs/research/v2/enterprise-benchmark-v2.html`
— is binding, and it moves the template onto four axes: **enterprise-only ·
deploy-per-tenant · Docker-first · Claude-first**. ADR-006's Vercel + Neon
prototype rail was tuned for a different audience: a non-developer reviewer
opening a shared `*.vercel.app` URL, zero ops in between. That optimization is
now the wrong default.

Enterprise customers self-host, one deployment per tenant, for data residency,
no SaaS lock-in, and air-gap capability. A rail that terminates in a
multi-tenant PaaS + managed Postgres cannot satisfy those constraints. Docker
must therefore become the *delivery* rail — the shipped, bootable unit — not
merely the mandatory build gate ADR-030 made it. ADR-030 verified "IT can run
this"; ADR-035 makes the container the thing IT actually runs in production.

## Decision drivers

Ranked:
1. **Enterprise self-host, one deployment per tenant** — the primary
   distribution model; everything else bends to it.
2. **No SaaS/PaaS lock-in + data residency** — the tenant owns the runtime, the
   data, and the network boundary.
3. **A reproducible, bootable, scanned artifact at any green commit** — the
   image is the contract handed across the trust boundary.
4. **Preserve the fast Claude-Code iteration loop** — the pivot must not tax the
   tight edit → `/ship` loop the template exists to protect.

## Considered options

### Option 1 — Docker-first self-host per tenant (chosen)
- Good: distroless multi-stage image, non-root, base pinned to a digest
  (Node 24, see ADR-038); `compose.prod.yaml` with profiles (bundled-Postgres
  vs. external/Neon DB URL); Caddy TLS reverse proxy; GHCR registry with a
  Harbor on-prem option; migration-at-startup (entrypoint chain for a single
  replica, a dedicated init-container migration job when replicas > 1, always
  over a direct URL, forward-compatible-only); WAL-G backups → object storage
  plus volume snapshots; Postgres image pinned to `pgvector/pgvector:pg18`.
- Good: satisfies drivers 1–3 directly; the image *is* the tenant deployment.
- Bad: WAL-G, Caddy, and compose-profile surface area is real ops the template
  now owns; more moving parts than a `git push`.
- Bad: NOT pgBackRest (unmaintained as of 2026-04) and NEVER Bitnami Postgres
  (free images deprecated 2025-08) — both had to be actively designed out.

### Option 2 — Keep Vercel + Neon as the deploy default
- Good: zero-ops for prototypes; the reviewer-URL loop stays frictionless.
- Bad: no self-host, no air-gap; SaaS lock-in and data-residency gaps fail the
  top driver outright.

### Option 3 — Kubernetes + Helm baseline
- Good: scales horizontally; familiar to enterprise platform teams.
- Bad: over-engineered for one-deployment-per-tenant; imposes a control-plane
  dependency most tenants don't want. Defer to P2 as a documented escape hatch
  (K3s + Helm) rather than the baseline.

## Decision

We adopt **Option 1: Docker-first self-host, one deployment per tenant.** The
deciding drivers are self-host per tenant (driver 1) and no lock-in + data
residency (driver 2): only a shipped container the tenant runs inside their own
boundary satisfies both, and neither Vercel+Neon nor a K8s baseline does. The
image is the primary delivery artifact — distroless, non-root, digest-pinned,
scanned — and `compose.prod.yaml` with DB profiles is the canonical production
topology, bundled Postgres or an external DB URL per tenant policy.

Vercel + Neon (ADR-006) is **retained as an opt-in prototype/preview option**,
demoted from default. The reviewer-URL loop still exists for disposable
`/quickstart` work and previews; it is a choice, not the terminus. The fast
`/ship` loop stays image-free (ADR-030), so day-to-day Claude iteration is
untouched.

## Consequences

### Positive
- Tenants get a reproducible, air-gap-capable deployment they fully own — no
  SaaS dependency in the production path.
- The delivery artifact is scanned and digest-pinned, extending the security
  floor across the trust boundary (ADR-041).
- One artifact, many tenants: the same green image deploys per tenant with only
  env/DB-URL and profile differences.

### Negative
- The template now owns real ops surface: compose profiles, Caddy TLS, WAL-G
  backups, migration-at-startup semantics for single vs. multi-replica.
- Docker (or a compatible builder) is a hard prerequisite for the delivery path;
  environments without a daemon must lean on CI or the ack.
- Losing the always-default Vercel URL removes the frictionless reviewer path
  for stakeholders who never touch infrastructure.

### Mitigations
- Cache-friendly multi-stage build keeps warm rebuilds cheap.
- The fast `/ship` loop stays image-free per ADR-030 — iteration speed preserved.
- `"dockerAck"` in `project.config.json` + an adjudicated
  `docs/findings-register.md` line covers environments that genuinely cannot
  build images, without silent drift.

## Alternatives considered
- **Vercel + Neon as default** — no self-host/air-gap, SaaS lock-in and
  residency gaps fail the top driver; retained only as an opt-in preview option.
- **Kubernetes + Helm baseline** — over-engineered for one-deployment-per-tenant;
  deferred to P2 as a K3s+Helm escape hatch, not the baseline.

## Migration triggers
- Revisit if a fork needs true multi-org-in-one-deployment → row-level security,
  a departure from ADR-011's tenancy-by-deployment model.
- Revisit if horizontal scale is needed → the K3s/Helm P2 escape hatch.
- Revisit when Next's standalone output contract changes (Dockerfile copy paths
  must track it).

## Related
- ADR-006 — Vercel + Neon (demoted to opt-in preview).
- ADR-011 — tenancy-by-deployment (now = one dockerized deployment per tenant).
- ADR-023 — Dockerfile / compose / Make implementation (kept).
- ADR-030 — Docker as a standard build gate (reframed to primary delivery rail).
- ADR-038 — Node 24 base image.
- ADR-040 — OpenTelemetry.
- ADR-041 — image scanning / supply chain.
- ADR-037 — enterprise floor.
- `docs/research/v2/enterprise-benchmark-v2.html` — pivot source of truth.
