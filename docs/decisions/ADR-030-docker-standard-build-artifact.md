# ADR-030 — Docker as a standard build artifact

**Status:** Accepted (operator sign-off 2026-07-02)
**Date:** 2026-07-02
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** ADR-023's **opt-in stance** ("Docker is an opt-in self-host
rail"). ADR-023's *implementation* (the `DOCKER_BUILD` gate in
`next.config.ts`, the multi-stage Dockerfile, compose files, Make targets,
dormant `docker-build.yml`) is kept as-is; what changes is the policy layer on
top. ADR-006 (Vercel + Neon as the **deploy** default) is unchanged.

## Context

ADR-023 (2026-06-24) made Docker a maintained but opt-in second rail. On
2026-07-02 the operator issued directive D2 of the replatform-and-adoption
program: **"Docker is always built — a standard, mandatory part of the stack."**

The distinction that keeps both directives coherent: Vercel + Neon remains the
*deploy* path (nothing about `git push` → URL changes), while the Docker image
becomes a *mandatory build gate and handoff artifact* — every app must always
be able to produce a bootable, scanned container image, and the harness
verifies this rather than hoping.

The open strictness question (blueprint Q2) was answered by the operator on
2026-07-02: **not** in every local fast-loop `/ship` run, but mandatory at
`/ship --full`, `/deploy`, `/handoff`, and in CI once Actions activate.

## Decision

1. **`DOCKER_BUILD=1` gating in `next.config.ts` stays** — standalone output
   remains env-scoped so the Vercel build is byte-for-byte untouched (ADR-023's
   one true constraint).
2. **The docker-build gate becomes standard, scoped by loop speed:**
   - `/ship` fast loop (default): unchanged, no image build.
   - **`/ship --full`, `/deploy`, `/handoff`: `make docker-build` must succeed**
     (image builds from the current tree) — a red gate, same standing as a
     failing test.
   - CI runs the image build + boot smoke test on every push once Actions
     activate (the existing dormant `docker-build.yml`, promoted from optional
     to expected).
   - Escape hatch, consistent with the ADR-025 pattern and never silent:
     `"dockerAck"` in `project.config.json` plus an adjudicated line in
     `docs/findings-register.md`.
3. **A standard artifact is a scanned artifact:** **trivy** image + config scan
   (deep-comparison cat 10 adoption) wired into `/audit` and the docker `/ship`
   phase. Findings triage through the findings register like any other gate.
4. **Lifecycle skills produce/verify the image:** `/quickstart`, `/new-project`,
   and `/handoff` verify the image builds; the generated `HANDOFF.md` documents
   `make docker-up` as the IT-team run path. `docker-compose` (app + Postgres)
   becomes the canonical local full-stack, aligning with ADR-031 (every app has
   a structured DB).
5. **Docs follow:** CLAUDE.md "Known traps" drops the "Docker is opt-in" note;
   `docs/token-policy.md` gains a thrift note if the gate's cost warrants one.

## Consequences

### Positive
- "Can IT run this?" is verified continuously, not discovered at `/handoff`.
- Self-host/on-prem forks get a guaranteed-green image at any commit that
  passed the full gate.
- Image scanning (trivy) extends the security floor to the container layer.

### Negative
- `/ship --full`, `/deploy`, and `/handoff` get slower (image build).
- Docker (or a compatible builder) becomes an environment prerequisite for the
  full gate — remote containers without a daemon must lean on CI or the ack.

### Mitigations
- Multi-stage, cache-friendly Dockerfile keeps warm rebuilds cheap.
- The fast `/ship` loop is untouched — day-to-day iteration speed is preserved.
- `"dockerAck"` + findings-register adjudication covers environments that
  genuinely cannot build images, without silent drift.
- CI ownership of the always-on build once Actions activate.

## Alternatives considered
1. **Image build in every local `/ship`** (the literal "always"). Rejected by
   the operator (blueprint Q2): it taxes the tight loop the template exists to
   protect, for no additional guarantee beyond the full-gate placement.
2. **Keep ADR-023 opt-in as-is.** Rejected by directive D2 — an artifact only
   built when someone remembers is not a standard artifact.
3. **Make Docker the deploy path.** Rejected (unchanged from ADR-023): it
   re-imports the ops burden ADR-006 deleted, for an audience that never
   touches infrastructure.

## Migration triggers
- Revisit gate placement if image-build time in `/ship --full` exceeds ~2× the
  rest of the gate combined (candidate: CI-only with a local ack default).
- Revisit if self-host becomes the common deploy case (then consider registry
  publishing — the commented GHCR push in `docker-build.yml` — as standard).
- Revisit when Next's standalone output contract changes (Dockerfile copy paths
  must track it; unchanged from ADR-023).

## Related
- ADR-023 — the rail this promotes (implementation kept, stance superseded).
- ADR-006 — Vercel + Neon deploy default (unchanged).
- ADR-025 — tiered enforcement gates (the ack/register escape pattern).
- ADR-031 — mandatory structured DB (compose app+DB alignment).
- `docs/blueprints/2026-07-replatform-and-adoption-program.md` Workstream B.
