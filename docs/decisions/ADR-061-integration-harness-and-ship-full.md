# ADR-061 — Ephemeral-DB integration harness + the warm/full `/ship` split

**Status:** Accepted (2026-07-17, Tariq Al-Naaimi — operator approved adopting
`@testcontainers/postgresql` in the Phase-4 dependency batch). Installed (dev-dependency);
`scripts/test-integration.mjs` + `npm run test:integration` + `npm run ship:full` wire it; the
container path is "verified where Docker present" (this build container has no daemon), the suite
round-trips verified 6/6 against the persisted native Postgres 16 + pgvector.
**Date:** 2026-07-17
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Amends:** ADR-030 (Docker as a standard build artifact — the same degrade-to-WARN posture and the
`--full`/`SHIP_FULL` loop this extends). **Relates to:** ADR-017 (`/ship` gate), ADR-058 (BDD
coverage — the other full-loop gate), ADR-036/ADR-006 (pgvector RAG substrate), V2-401, V2-402.

## Context

Phases 0–3 built the gates but the integration/Neon claim stayed a **warn, not a run**: the
integration suite (`tests/integration/*.test.ts` — pgvector round-trip, audit + soft-delete on a
real DB) self-skips without a `DATABASE_URL`, so warm `/ship` (deliberately DB-free for speed —
Pillar 1) never exercises it and CI had no way to provision a DB. The result: "it works with a DB"
was asserted, not demonstrated. Phase 4's mandate is to turn each waved-off claim into a
machine-checked one, and to make the constitution state exactly what warm-green vs full-green means.

## Decision drivers

- Warm `/ship` MUST stay fast and DB-free (the velocity pillar; ~60–80s warm loop).
- The integration claim needs a REAL Postgres with the `vector` extension, hermetic and ephemeral —
  not a shared stateful dev DB, and not hand-rolled `docker run` plumbing.
- The gate must run everywhere: a dev box, CI with Docker, and a DB-less sandbox — degrading
  honestly (never a false RED, never a silent PASS) where no DB can be provisioned.

## Considered options

### Option 1 — `@testcontainers/postgresql` behind a resolver script (chosen)

`scripts/test-integration.mjs` resolves a DB three ways in order: (1) an existing reachable
`DATABASE_URL`; (2) else a Docker daemon → start an ephemeral `pgvector/pgvector:pg16` container,
`prisma migrate deploy` into it, run the suite, tear it down; (3) else print an honest skip notice
and let the DB-guarded tests self-skip. Exit non-zero ONLY on a genuine failure (a DB was present
and a round-trip failed). `ship:full` (`SHIP_FULL=1`) adds it to `scripts/ship.mjs`'s FULL phase,
degrade-to-WARN on the skip path (mirrors the ADR-030 docker gate).

### Option 2 — a hand-rolled `docker run postgres` wrapper

Rejected: this repo would then own readiness polling, teardown-on-crash, image pinning, and pgvector
provisioning — exactly the fragile plumbing testcontainers exists to remove.

### Option 3 — docker-compose + a fixed dev DB (`make db-up`)

Kept for LOCAL dev, but a shared fixed DB is stateful across runs and not ephemeral-per-run — wrong
for a hermetic gate and for CI, and it can't run isolated suites in parallel.

## Decision

Adopt `@testcontainers/postgresql` (dev-dependency, 0 vulnerabilities) as Option 1. Split the gate
explicitly:

- **Warm `/ship`** (`npm run ship`) — DB-free: typecheck, lint, format, contract/component/hook
  tests, the scalability/copy/wave-off/licenses/tier/blueprint/complexity/coverage scans, build,
  size-limit, gitleaks, npm-audit, ai-eval. This is what a normal push runs.
- **Full `/ship`** (`npm run ship:full` / `SHIP_FULL=1`, and thus `/deploy`, `/handoff`, CI) — warm
  loop **plus** the docker image-build + trivy scan (ADR-030), the BDD traceability gate (ADR-058),
  and now the **integration** gate (this ADR). The app-dependent QA slices (`uat:lean`,
  `visual-regression`) remain the responsibility of `/qa` and `uat:full` — they need a live app +
  seeded DB + browser + a committed baseline the CI-less gate can't assume, so forcing them into
  `ship:full` would make it un-runnable in a headless env.

## Consequences

**Positive:** the integration/Neon claim is now a real run wherever Docker or a pgvector DB is
reachable; warm `/ship` is untouched; the warm-vs-full contract is explicit in CLAUDE.md +
`.claude/rules/harness.md`. **Negative:** `ship:full` needs Docker (or a DB) to actually exercise
the round-trips; without either it WARNs. Mitigated: the persisted native-Postgres path (path 1)
gives a real run in this environment; the container path is verified where Docker is present
(recorded as an environmental constraint in `docs/findings-register.md`).

## Related

- ADR-030 (`--full`/`SHIP_FULL` loop + degrade-to-WARN posture — extended here).
- `scripts/test-integration.mjs`; `tests/integration/*.test.ts`; `docs/build-vs-buy-ledger.md`
  (V2-401); `docs/findings-register.md` (container-run constraint).
