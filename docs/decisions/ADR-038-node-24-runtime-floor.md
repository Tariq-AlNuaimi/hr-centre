# ADR-038 — Node 24 as the runtime floor

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Amends:** ADR-001 (locked stack — Node version) and ADR-035 (Docker base image).

## Context

The repo currently targets Node 22. Node 22 has entered Maintenance-LTS:
security-only after Oct 2026, EOL Apr 2027. Node 24 is the Active LTS line.
The enterprise pivot report (`docs/research/v2/enterprise-benchmark-v2.html`,
category C01) rates this a cheap P0 drop-in that removes a 2027 EOL cliff.

These are point-in-time facts (as of the 2026-07-11 pivot pass) and are cited
verbatim; the Migration triggers below say when to re-check them.

## Decision drivers

- Remove the 2027 Node 22 EOL cliff — the runtime floor should sit on Active
  LTS, not on a line that goes security-only in months.
- Drop-in cost: no application code changes are expected.
- A reproducible, pinned base image for the Docker-first rail (ADR-035).

## Considered options

### Option 1 — Node 24 Active LTS (chosen)

Bump the Docker base image and `@types/node` to Node 24; pin the base image to
a **digest** (not a floating tag) so the image is reproducible.

- Good: on Active LTS through ~2027; cheap drop-in.
- Bad: requires a re-verify pass (native deps rebuild in the image).

### Option 2 — Stay on Node 22

- Bad: security-only after Oct 2026, EOL Apr 2027 — a self-inflicted cliff.

### Option 3 — Adopt Bun as the primary runtime

- Good: fast.
- Bad: napi/ecosystem-compat risk for Prisma and native deps. DEFER —
  optionally allow Bun as a dev/test runner only.

## Decision

Move the runtime floor to **Node 24 Active LTS**: bump the Docker base image
(pinned to a digest) and `@types/node` to 24, then run a re-verify pass. The
deciding driver is the Node 22 EOL cliff at Apr 2027 — retired at essentially
drop-in cost, with no expected application code changes.

## Consequences

### Positive

- The runtime floor sits on Active LTS through ~2027; the 2027 EOL cliff is gone.
- A digest-pinned base image makes the Docker-first rail reproducible.

### Negative

- Native deps must be rebuilt against Node 24; a re-verify pass is required
  before the bump is green.

### Mitigations

- The Docker-first rail rebuilds native deps against 24 in-image, so
  `@node-rs/argon2` and friends are compiled clean rather than relying on a
  host prebuild — see ADR-039.

## Alternatives considered

- **Stay on Node 22** — rejected: EOL Apr 2027 is a self-inflicted cliff.
- **Bun as primary runtime** — deferred: napi/Prisma compat risk; allowed as a
  dev/test runner only.

## Migration triggers

- Revisit when Node 24 enters Maintenance-LTS and Node 26 becomes the Active
  line (Node 24 is expected to enter Maintenance ~2026-10) — then bump the floor
  to the next Active LTS on the same drop-in playbook.
- Reconsider Bun as a runtime option if its Prisma/napi compatibility story
  matures.

## Related

- ADR-001 — locked stack (Node version amended here).
- ADR-035 — Docker base image (pinned to a Node 24 digest here).
- ADR-039 — native-dep rebuild in-image against Node 24.
- `docs/research/v2/01-core-framework.md` — pivot research backing C01.
