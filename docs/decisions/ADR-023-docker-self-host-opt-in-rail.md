# ADR-023 — Docker as an opt-in self-host rail

**Status:** Superseded in part by ADR-030 (2026-07-02) — the **opt-in stance** is superseded
(Docker is now a standard build artifact, gated at `/ship --full`/`/deploy`/`/handoff`/CI);
the implementation this ADR shipped (DOCKER_BUILD gate, Dockerfile, compose, Make targets,
docker-build.yml) is kept and remains authoritative.
**Date:** 2026-06-24
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Extends:** ADR-006 (Vercel + Neon stays the default deploy rail). Partially
restores the `output: "standalone"` capability ADR-006 dropped — as an opt-in
build flag, NOT a baseline.

## Context

ADR-001 originally locked a self-hosted Docker baseline (Next.js standalone +
Postgres + MinIO + Portainer + GHCR). ADR-006 deleted that whole surface and
pivoted to Vercel + Neon: `git push` → URL in ~90s, zero infrastructure for the
non-developer operator. That pivot was correct for the prototype rail and is not
being undone.

But ADR-006 left exactly one escape hatch — "re-enable `output: "standalone"` in
`next.config.ts` and add a Dockerfile from the pre-pivot tag" — as an
undocumented, untested, ~5-minute manual step described only in prose. Two real
needs make that too thin:

1. **Self-host / on-prem / air-gapped forks.** Some prototypes graduate into
   environments where Vercel is not an option (data residency, internal-only
   networks). They need a container image that actually builds and boots, not a
   git-archaeology exercise.
2. **A credible `/handoff` story.** The IT team that takes a project to
   production (ADR-006) frequently runs its own container platform. A maintained,
   reference Dockerfile + compose is the artifact they want.

The operator asked to "standardize Docker for the apps." Making Docker the
_primary_ rail would re-import the 8 integration boundaries and 14 secrets
ADR-006 deleted, for an audience that never sees infrastructure — a regression.
The standardization that fits is a **maintained, opt-in second rail** that leaves
the default untouched.

## Decision

Add a first-class but **opt-in** Docker rail. Vercel + Neon remains the default;
nothing about the `git push` deploy path changes.

1. **`output: "standalone"` is gated on `DOCKER_BUILD`.** `next.config.ts` emits
   it only when `DOCKER_BUILD=1`/`true`. On Vercel (flag unset) the build is
   byte-for-byte unchanged, so ADR-006 is fully preserved.
2. **Multi-stage `Dockerfile`** (deps → builder → runner). Runner ships only the
   traced standalone server + static/public + the Prisma client, runs as a
   non-root user, injects `DATABASE_URL`/secrets at runtime (never baked), and
   runs `prisma migrate deploy` on boot — matching the Vercel `buildCommand`
   migration contract.
3. **`docker-compose.dev.yml`** runs the full stack (app + Postgres) for local
   parity. The existing `docker-compose.yml` (DB only) is kept for the lighter
   "DB-in-Docker, app via `npm run dev`" loop.
4. **Makefile targets:** `docker-build`, `docker-run`, `docker-up`, `docker-down`.
5. **Dormant `docker-build.yml` CI** builds the image and smoke-tests that it
   boots and serves. Dormant on the free plan like the other ops workflows
   (ADR-006 §7); activates at `/handoff` or with paid Actions.
6. **Docs:** README + CLAUDE.md known-traps note + the `/handoff` skill's
   generated HANDOFF.md document the rail and the re-containerize steps.

The security floor is unchanged: auth wrappers, audit, soft-delete, zod, the ten
ESLint rules, and `/ship` all apply identically regardless of deploy rail.

## Consequences

### Positive

- Self-host forks get a tested image, not a manual escape hatch.
- `/handoff` produces a real container artifact for the IT team.
- Default rail (Vercel + Neon) is provably untouched — the standalone output is
  off unless `DOCKER_BUILD` is set, so no Vercel build behavior changes.
- Full local parity for forks that want to exercise the production-like server.

### Negative

- More surface to maintain: a Dockerfile + compose + CI that can rot if Next's
  standalone contract changes (static/public copy paths, Prisma engine location).
- Two deploy rails means two places a "how do I ship this" answer can live;
  docs must keep pointing at Vercel as the default to avoid confusing operators.

### Mitigations

- The dormant `docker-build.yml` smoke test (boot + HTTP probe) is the guard
  against silent standalone-output rot; activate it at `/handoff`.
- Every Docker artifact's header states "opt-in; Vercel is the default (ADR-006)"
  so the rail can't be mistaken for the baseline.
- `DOCKER_BUILD` gating keeps the blast radius of the `next.config.ts` change to
  zero on the default path.

## Alternatives considered

1. **Make Docker the primary rail (replace Vercel).** Rejected: re-imports the
   ops burden ADR-006 deleted for an audience that never touches infrastructure.
2. **Leave the prose-only escape hatch as-is.** Rejected: untested and
   undiscoverable; the first fork that needs it pays the full cost.
3. **A separate `fullstack-paas-template` repo** (per ADR-005's note). Rejected
   as premature — one opt-in rail in this template is cheaper than a fork until
   self-host demand actually materializes.

## Migration triggers

- Revisit if self-host becomes the _common_ case (then promote Docker nearer to
  parity and reconsider the default).
- Revisit if Next.js changes the standalone output contract in a way the
  Dockerfile copy steps must track (pin + update here).
- Revisit if a fork needs registry publishing as standard (wire the commented
  GHCR push in `docker-build.yml` into the active path).

## Related

- ADR-006 — Pivot to Vercel + Neon (the default rail this extends).
- ADR-001 — Template baseline (original Docker baseline, superseded by ADR-006).
- ADR-005 — Deployment platform options (PaaS-vs-droplet history).
- `Dockerfile`, `docker-compose.dev.yml`, `.dockerignore`, `Makefile`,
  `.github/workflows/docker-build.yml`, `next.config.ts` (`DOCKER_BUILD` gate).
