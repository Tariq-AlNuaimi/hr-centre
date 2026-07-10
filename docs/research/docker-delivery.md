# Docker-First Delivery & Infrastructure — Enterprise Pivot Benchmark

**Domain:** Container packaging, orchestration, self-hosted data plane, and delivery mechanics for the enterprise pivot.
**As-of:** 2026-07. Star counts / versions / "enterprise uses X" claims verified via web where noted; treat un-cited assertions as engineering judgment against the fixed stack.
**Author lens:** Docker-first delivery. Coordinates with (but does not own) the identity/secrets and AI-runtime domains.

## Domain summary & mapping to the pivot

The pivot inverts the delivery unit: from **Vercel+Neon `git push`** (ADR-006) to a **dockerized Next.js app + dockerized Postgres as the fork-and-ship unit**, production-grade from day one, **deploy-per-tenant** (no in-app row-level tenancy — ADR-011 stays), **compose now / k8s-ready later**. This domain owns everything from the `Dockerfile` down to the disk the database writes to: the production image, `docker-compose.prod.yml` (app + Postgres + Redis + object store + reverse proxy), connection pooling, object storage, TLS, registry, migration-at-startup, zero-downtime deploy, backup/DR, and runtime secrets mechanics.

The good news: the repo **already ships a correct multi-stage standalone Dockerfile** (non-root, `output:"standalone"` gated behind `DOCKER_BUILD=1`, `prisma migrate deploy` at entrypoint) and dev compose files. The pivot is mostly **promoting existing scaffolding to default + adding the production compose topology + the data-plane operational layer** (pooling, backup, object store, proxy), not a from-scratch build. The single biggest constraint the current image respects and must keep: `output:"standalone"` stays env-gated so a Vercel fallback build is byte-identical (ADR-030 §1).

Cross-cutting reality check from research: two "obvious" default picks moved in 2025–2026 — **MinIO community edition went into maintenance mode (Dec 2025)** and **pgBackRest had a maintenance scare (archived-then-un-archived, "will continue" as of 2026-05-18)**. Both are flagged below; neither is fatal but both change the default recommendation.

---

## Capability 1 — Production Next.js Dockerfile

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Base image + strategy | `node:22-alpine` multi-stage + `output:"standalone"` | `node:*-alpine` standalone (Vercel's own example pattern) | `gcr.io/distroless/nodejs22` runner (no shell, minimal CVE surface) | Alpine standalone (all OSS) | **Keep alpine standalone now; offer distroless runner as a `/harden` opt-in** | 5 | Repo Dockerfile already does this correctly. Alpine base ~50 MB, distroless ~30 MB; realistic Next standalone runtime image **200–450 MB** [8]. Distroless = smaller attack surface but no shell → the current `CMD ["sh","-c", "migrate deploy && node server.js"]` breaks; needs an entrypoint JS wrapper or init-container (see Cap 8) [8]. |

**Notes:** The shipped image is already best-practice: three stages (deps/builder/runner), non-root `nextjs:1001`, `libc6-compat` for Prisma engines, static + public copied per the standalone contract, DB URL injected at runtime not baked. **Two upgrades for enterprise:** (a) add a `HEALTHCHECK` (needed for compose zero-downtime — Cap 9) and (b) pin the base by digest, not just tag, so builds are reproducible for SBOM/trivy (ADR-030 §3). Distroless is a *later* hardening lever, not a v1 blocker — its shell-less nature complicates the migrate-at-start pattern the repo depends on.

## Capability 2 — Local+prod orchestration (`docker-compose.prod.yml`)

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Orchestrator (v1) | Docker Compose v2 (`compose.yaml` spec) | Docker Compose | Compose now → **k8s-ready** manifests later (operator decision #3) | Compose (all OSS) | **Ship `docker-compose.prod.yml`: app + postgres + redis + object-store + reverse-proxy, health-checked, named volumes, compose `secrets`** | 5 | Operator has fixed compose-now/k8s-later. The repo has `docker-compose.dev.yml` + `.yml`; the prod file is net-new. Structure services + env + secrets so a future Helm chart maps 1:1 (one Deployment per compose service). |

**Notes:** Prod compose shape to standardize: `app` (the standalone image, `depends_on` postgres healthy), `postgres:17`, `redis:7` (distributed rate-limit + future job queue — the in-memory limiter breaks multi-container, per pivot analysis §Axis 3), object store (Cap 5), reverse proxy (Cap 6). Every service gets a `healthcheck` and `restart: unless-stopped`. Use compose `secrets:` (file-backed) not `environment:` for Restricted values (Cap 11). Keep dev compose lean (app+pg) for the fast loop; prod compose is the full topology and the `/handoff` artifact.

## Capability 3 — Self-hosted Postgres in a container

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Postgres container | Official `postgres:17` image + named volume | Official `postgres` (Docker Official Image) | Patroni (HA, needs etcd/consul) [n] or CloudNativePG (k8s-only) | `postgres:17` + `pgvector` | **`postgres:17-alpine` (or `pgvector/pgvector:pg17`) + named volume, tuned config, `pg_isready` healthcheck; single-node in v1** | 5 | Deploy-per-tenant + compose-now means **single-node Postgres is correct for v1** — HA (Patroni) needs a 3-node etcd + HAProxy quorum [7] that contradicts "no k8s / compose-now" and adds ops burden per tenant. pgvector needed for the future AI layer (pivot Axis 2) → use the `pgvector/pgvector:pg17` image so the extension is one `CREATE EXTENSION` away. |

**Notes:** v1 HA posture = **vertical (bigger box) + fast restore (Cap 10), not replication.** Persistent named volume (or bind mount for snapshot backups), a mounted `postgresql.conf` (shared_buffers/work_mem tuned to the box), and `pg_isready` healthcheck gating app start. Patroni [7] and CloudNativePG (k8s-native operator [7]) are the **k8s-later** HA path — document them as the migration target, don't ship them. HA-in-compose is a genuine anti-pattern (split-brain risk without a real DCS).

## Capability 4 — Connection pooling

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Pooler | **PgBouncer** (single binary, ~2 MB/1k clients) | PgBouncer | PgBouncer (used by ~every major PG deploy) / pgcat for read-splitting+sharding | PgBouncer / pgcat (Rust) | **PgBouncer sidecar in transaction mode + Prisma `?pgbouncer=true`** | 5 | PgBouncer is battle-tested AND pure-OSS (lenses overlap) [1]. Single-threaded → one core; spawn a second instance beyond ~heavy load, but for a per-tenant deploy that ceiling is far off [1]. Prisma has **explicit PgBouncer support** via `?pgbouncer=true` (disables prepared-statement caching that breaks in transaction mode) [1][prisma-docs]. |

**Notes:** With Prisma 7 the app already holds a client-side pool; the pivot's multi-container app + serverless-style connection churn is exactly what PgBouncer fixes (bounds Postgres backend connections). **pgcat** (Rust, multi-threaded, read-replica routing + sharding) is the upgrade lever *if* a tenant grows read replicas — keep as option [1]. **Supavisor** (Elixir, Supabase) is built for massive multi-tenant serverless — overkill for deploy-per-tenant, reject as default [1]. Set Prisma `connection_limit` low per app replica since PgBouncer fans out.

## Capability 5 — Object storage

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| S3-compatible store | MinIO (**now maintenance-mode**) | MinIO (still highest-star S3-compat) | Cloud S3 (AWS/GCS) via S3 API, or Garage on-prem | **Garage v2** (Rust, Apache-2.0) or SeaweedFS (Apache-2.0) | **Interface to the S3 API (`@aws-sdk/client-s3`); default self-host = Garage v2; MinIO allowed but frozen; cloud S3 the drop-in option** | 4 | **MinIO community edition entered maintenance mode Dec 2025** — no new features, security fixes case-by-case, admin web UI stripped in Mar 2025 [2][minio-maint]. Don't hard-wire MinIO as the strategic default. Garage v2.0 (Jun 2025) added a proper admin API + is aimed as the modern MinIO replacement for small/medium deploys [2]. SeaweedFS (Apache-2.0) scales to billions of files [2]. |

**Notes:** File uploads are **not wired today** (ADR-006). The right move: build against the **S3 API abstraction** so the concrete backend (Garage self-host / MinIO frozen / AWS S3 / GCS) is a config swap — this is a build-vs-buy ledger entry (adopt `@aws-sdk/client-s3`, don't hand-roll). For deploy-per-tenant on-prem, **Garage** is the cleanest OSS default (single Rust binary, no JVM, S3-compatible) [2]; **cloud S3** stays the KEEP-AS-OPTION for cloud tenants. RustFS is promising but alpha — watch, don't adopt [2].

## Capability 6 — Reverse proxy / TLS termination

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Proxy + TLS | Nginx | Nginx | Nginx (enterprise change-mgmt/runbooks) / Traefik (dynamic) | **Caddy** (auto-HTTPS, Apache-2.0) / Traefik | **Caddy as the default (automatic Let's Encrypt, 3-line config); Traefik as the label-driven option; Nginx for enterprises that mandate it** | 5 | Single-app-per-deploy (deploy-per-tenant) = few services that rarely change → **Caddy is the sweet spot** (automatic HTTPS + renewal, minimal config, no Docker-socket dependency) [3]. Traefik shines at 10+ services / k8s via Docker-label auto-discovery — that's the k8s-later story [3]. Nginx = most control + the path of least resistance where enterprise runbooks demand it [3]. |

**Notes:** Caddy's automatic-HTTPS removes the biggest ops paper-cut (cert issuance/renewal) for a per-tenant fork — matches "production-grade from day one" with near-zero config [3]. Caddy also does **not** need the Docker socket (a security plus vs Traefik's socket mount) [3]. Provide the `Caddyfile` in the prod compose; document a Traefik label variant for the k8s-bound future and an Nginx variant for regulated tenants. TLS terminates at the proxy; app stays HTTP on the internal network. AUTH_URL must be set explicitly (Vercel auto-injected it — known trap becomes the default path).

## Capability 7 — Container registry

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Registry | Docker Hub / **GHCR** | Docker Hub | **Harbor** (CNCF graduated, ~30.5k★) [4] / cloud ECR/GAR | Harbor (Apache-2.0) / GHCR (free for public) | **GHCR as the default (repo already on GitHub, Actions-native publish); Harbor as the enterprise self-host/air-gapped option** | 5 | GHCR is OCI-compliant, permissions tied to the GitHub repo, Actions drives publish — zero new infra for a GitHub-hosted template [4]. The existing dormant `docker-build.yml` has a commented GHCR push (ADR-030 migration trigger) — promote it. **Harbor** (CNCF graduated, ~30.5k★ as of 2026-07, Trivy scanning built-in, replication, RBAC, SBOM-on-push) is the pick for air-gapped/on-prem enterprises that can't use a public registry [4]. |

**Notes:** For deploy-per-tenant to customer infra, some tenants will demand an **in-perimeter registry** — Harbor is the answer and it *also* runs in compose, so it slots into the same delivery story [4]. ECR/GAR are KEEP-AS-OPTION for cloud tenants. GHCR free private tier is limited (500 MB/1 GB-bw) but public images are unlimited [4] — fine for the template's own images.

## Capability 8 — DB migrations at container start

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Migrate-at-start | `prisma migrate deploy` in entrypoint | (Prisma default pattern) | **Dedicated migration step** (init-container / one-shot compose service) before app replicas start | Prisma migrate (OSS) | **Keep entrypoint `migrate deploy` for single-replica v1; move to a one-shot `migrate` service/init-container the moment >1 app replica exists** | 4 | Current `CMD` runs `migrate deploy && node server.js` — **correct and safe at 1 replica**, which is the deploy-per-tenant v1 norm. Prisma takes a **pg advisory lock** so concurrent `migrate deploy` don't corrupt state, BUT the lock has known **deadlock/timeout race issues** across replicas [5], and `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` exists since 5.3.0 [5]. |

**Notes:** The multi-replica race is real: N replicas each running `migrate deploy` on boot can deadlock on the advisory lock or time out (10 s) [5]. **Enterprise pattern:** a separate one-shot migration unit (compose `migrate` service with `depends_on` postgres-healthy, or a k8s init-container/Job) runs migrations **exactly once**; app replicas start after it completes and do **not** run migrations themselves [5]. Since v1 is single-replica per tenant, the entrypoint pattern is fine now — but **structure the compose so extracting migrations into a one-shot service is a config change, not a Dockerfile rewrite** (k8s-ready). Note: distroless runner (Cap 1) forces this split anyway (no shell for the `&&`).

## Capability 9 — Zero-downtime deploy & rollback

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Deploy strategy | Rolling update behind a reverse proxy | Blue-green via proxy | Blue-green (proxy re-point) → k8s RollingUpdate later | Compose + proxy + healthchecks (OSS) | **Blue-green via the Caddy/Traefik proxy + healthchecks + graceful shutdown (`stop_grace_period`); maps to k8s RollingUpdate later** | 4 | Compose-level zero-downtime = start green alongside blue, health-check green, shift proxy traffic, drain+stop blue [6][9]. Requires: a `HEALTHCHECK` in the image (Cap 1 gap), `stop_grace_period` for graceful SIGTERM, and forward-compatible migrations (CLAUDE.md already mandates: never drop a column the running version reads) [6]. |

**Notes:** Two knobs make it work and both are already partly in the repo's discipline: **(1) forward-compatible migrations** (expand-then-contract) so blue and green can run against the same schema during the swap — CLAUDE.md/`vercel.json` already enforce "small, forward-compatible, never drop columns the running version reads"; **(2) graceful shutdown** so in-flight requests drain. Traefik/Caddy blue-green is the documented compose pattern [6][9]. This maps cleanly to k8s `RollingUpdate` + readiness probes later (the healthcheck becomes the readiness probe) — honoring compose-now/k8s-ready. **Rollback** = re-point proxy to the previous image tag (keep last-good tag pinned in the registry).

## Capability 10 — Backup / DR for dockerized Postgres

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Backup + PITR | **pgBackRest** (mature, PITR) | pgBackRest | pgBackRest (>500 GB, mature) / **WAL-G** (cloud-native, containers) | pgBackRest / WAL-G (both OSS) | **WAL-G for container/cloud-native PITR default; nightly `pg_dump` as the simple floor; pgBackRest allowed but watch its maintenance status** | 4 | **pgBackRest had a 2026 maintenance scare** — README shows "No Longer Being Maintained" (Apr 27) then **"Will Continue!" (May 18, 2026)**; latest v2.58.0 (Jan 2026), repo still active [pgbackrest-gh]. **WAL-G** is now the recommended pick for new cloud-native/Docker PostgreSQL deploys — delta backups, S3-native PITR, fits containers [pg-backup-cmp]. Both do second-precise PITR via WAL archiving [pg-backup-cmp]. |

**Notes:** DR tiers for a per-tenant single-node DB: **(floor)** nightly `pg_dump` to the object store (Cap 5) via a compose cron/one-shot — trivial, covers most internal-tool RPO needs; **(standard)** WAL-G continuous WAL archiving to S3/Garage → PITR to any second [pg-backup-cmp]; **(volume)** filesystem/volume snapshots if the host provides them (fast full-instance restore, coarser granularity). WAL-G's S3-native design means it reuses the same object-store backend the app already runs (Cap 5) — one storage dependency, not two. pgBackRest stays KEEP-AS-OPTION given it "will continue" but re-evaluate at the next quarterly stack-refresh.

## Capability 11 — Secrets at runtime

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit | Notes |
|---|---|---|---|---|---|---|---|
| Runtime secrets | Compose `secrets:` (file-backed, `/run/secrets/*`) | Env vars (common but weaker) | External secret manager (Vault / cloud KMS) → mounted | Docker/compose secrets, SOPS+age (OSS) | **Compose file-backed `secrets:` for v1 (not `environment:`); coordinate a Vault/KMS seam with the identity domain for later** | 4 | Container mechanics: `environment:` leaks into `docker inspect`, image history, and child-process env; **compose `secrets:` mount files at `/run/secrets/<name>`** read at boot — better isolation. This is the container half; the *sourcing* of secrets (Vault, sealed-secrets, cloud KMS) is the identity domain's call — cover the mount mechanics here, defer the manager choice. |

**Notes:** CLAUDE.md hard rules bind here: **never commit `.env`, never log Restricted env** (gitleaks gates `/ship`). `DATABASE_URL`, `AUTH_SECRET`, `SMTP_*`, `CRON_SECRET` must be injected as compose secrets, never baked into the image (the Dockerfile already respects this for `DATABASE_URL`). For a Prisma URL that must be a single env string, a small entrypoint step can assemble `DATABASE_URL` from `/run/secrets/*` files (`*_FILE` convention, like the postgres image's `POSTGRES_PASSWORD_FILE`). The step-up to a real manager (Vault/SOPS+age/cloud KMS) is a **coordinate-with-identity-domain** item, ADOPT-LATER.

---

## Seed-list verdicts

| Seed item | Verdict | Rationale | ADR impact |
|---|---|---|---|
| Dockerfile multi-stage / `output:standalone` **default-on** | **ADOPT-v1** (nuanced) | Multi-stage image already correct; make the **Docker path the default delivery**, but **keep `DOCKER_BUILD=1` env-gating** so a Vercel fallback build stays byte-identical (ADR-030 §1). "Default-on" = default *delivery target*, not unconditional `standalone` in `next.config.ts`. | Reframes ADR-030 (build-artifact → primary delivery); supersedes ADR-006's deploy default |
| `docker-compose.prod.yml` (app+pg+redis+objstore+proxy) | **ADOPT-v1** | The core new artifact; health-checked, secrets-backed, k8s-mappable. Redis is baseline now (in-memory rate limiter breaks multi-container). | New ADR (compose prod topology) |
| Self-hosted dockerized Postgres (**default**) | **ADOPT-v1** | `postgres:17` (use `pgvector/pgvector:pg17` for the AI layer) + named volume, single-node. Honors operator decision #5. | Reframes ADR-006/ADR-031 |
| Neon (as option) | **KEEP-AS-OPTION** | Managed PITR/branching for cloud tenants; a `DATABASE_URL` swap, no restructure. Not the default anymore. | ADR-006 demoted to optional |
| PgBouncer | **ADOPT-v1** | Battle-tested + OSS, explicit Prisma support (`?pgbouncer=true`), tiny footprint; bounds backend connections for the multi-container app [1]. | New ADR (data-plane) |
| MinIO/S3 object store | **RESEARCH-DECIDES → adopt S3-API abstraction; default self-host = Garage, not MinIO** | **MinIO CE went maintenance-mode Dec 2025** [2] — do not enshrine it as strategic default. Build to the S3 API; default OSS backend = **Garage v2**; cloud S3 the option. | New ADR + build-vs-buy ledger (`@aws-sdk/client-s3`) |
| Reverse proxy (Nginx/Caddy/Traefik) | **ADOPT-v1 → Caddy default** | Auto-HTTPS + minimal config fits single-app-per-deploy; Traefik = label/k8s option, Nginx = regulated-tenant option [3]. | New ADR |
| Container registry (GHCR/ECR) | **ADOPT-v1 → GHCR default** | GitHub-native, Actions publish, promote the dormant `docker-build.yml` GHCR push; **Harbor** for air-gapped enterprise [4]. | Reframes ADR-030 migration trigger |
| Helm/k8s (deferred, k8s-ready) | **ADOPT-LATER** | Operator decision #3: compose now, k8s-ready. Structure images/config/secrets for 1:1 Helm mapping; ship no k8s in v1. | Documented as migration target |
| Migration-at-startup | **ADOPT-v1 (entrypoint) + ADOPT-LATER (one-shot unit)** | Entrypoint `migrate deploy` is safe at single-replica v1; extract to a one-shot migrate service/init-container before any multi-replica tenant (advisory-lock race) [5]. | New ADR (migration lifecycle) |
| Backup/DR | **ADOPT-v1** | Nightly `pg_dump` → object store as the floor; **WAL-G** for container-native PITR (pgBackRest had a 2026 maintenance scare, "will continue" but watch it) [pg-backup-cmp][pgbackrest-gh]. | New ADR (DR posture) |
| Zero-downtime deploy | **ADOPT-v1** | Blue-green via the proxy + healthchecks + graceful shutdown + forward-compatible migrations; maps to k8s RollingUpdate later [6][9]. Requires adding a `HEALTHCHECK` to the image. | New ADR (deploy strategy) |

**No hard REJECTs.** Closest to reject: **Supavisor** as pooler (overkill for deploy-per-tenant — PgBouncer wins) and **Patroni/CloudNativePG HA in compose** (anti-pattern without a real DCS — defer to k8s-later). **MinIO as the strategic default** is effectively rejected (maintenance mode) in favor of the S3-API abstraction with Garage as the OSS default.

## Sequencing

**v1 baseline prerequisites (must ship together — the dockerized fork-and-ship unit):**
1. Production `Dockerfile` upgrades: add `HEALTHCHECK`, pin base by digest (builds on the existing correct image).
2. `docker-compose.prod.yml`: app + `postgres:17`(pgvector) + `redis:7` + reverse proxy, all health-checked, named volumes, compose `secrets:`.
3. **Caddy** reverse proxy + automatic TLS in the prod compose (set `AUTH_URL` explicitly).
4. **PgBouncer** sidecar + Prisma `?pgbouncer=true`.
5. Migration-at-startup: keep entrypoint `migrate deploy` (single-replica), but shape compose so a one-shot migrate unit is a config lift.
6. **GHCR** publish: promote the dormant `docker-build.yml` push.
7. Backup floor: nightly `pg_dump` → object store, documented restore.
8. Runtime secrets via compose `secrets:` (no Restricted value in `environment:`).

**Later (ADOPT-LATER / k8s-ready seams — do not block v1):**
- Object store hardening: pick Garage vs cloud S3 per tenant (S3-API abstraction lands in v1; concrete default can follow).
- WAL-G continuous PITR (floor is `pg_dump`).
- Blue-green zero-downtime scripting (single-tenant tolerates brief restart initially; harden once traffic warrants).
- One-shot migration service / init-container (needed only when a tenant goes multi-replica).
- Distroless runner, external secret manager (Vault/KMS), Traefik/Nginx proxy variants, Harbor registry, Patroni/CloudNativePG HA — all k8s-later or regulated-tenant options.

**Dependency notes:** Redis is a v1 baseline (unblocks the distributed rate limiter the multi-container app requires). pgvector image choice in v1 is near-free and unblocks the AI domain's Axis-2 work later. The `HEALTHCHECK` (Cap 1) is a prerequisite for zero-downtime (Cap 9). WAL-G reuses the object store (Cap 5) — sequence object store before continuous PITR.

## Sources

1. PgBouncer vs pgcat vs Supavisor — https://www.pkgpulse.com/blog/pgbouncer-vs-pgcat-vs-supavisor-postgresql-connection-2026 ; Tembo pooler benchmark — https://legacy.tembo.io/blog/postgres-connection-poolers/ ; Prisma+PgBouncer — https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
2. MinIO maintenance mode & alternatives — https://www.infoq.com/news/2025/12/minio-s3-api-alternatives/ ; https://blog.elest.io/minio-is-in-maintenance-mode-your-guide-to-s3-compatible-storage-alternatives/ ; Garage v2 / SeaweedFS — https://bizety.com/2025/12/06/minio-in-maintenance-mode-open-source-alternatives/
3. Reverse proxy comparison 2026 — https://www.virtua.cloud/learn/en/concepts/traefik-caddy-nginx-docker-reverse-proxy ; https://hostim.dev/blog/reverse-proxy-showdown/ ; https://instadevops.com/blog/nginx-vs-traefik-vs-caddy-reverse-proxy-comparison/
4. Harbor (goharbor/harbor, ~30.5k★, CNCF graduated) — https://github.com/goharbor/harbor ; GHCR guide — https://www.gecko.security/blog/ghcr-github-container-registry-guide ; registry comparison — https://shipyard.build/blog/container-registries/
5. Prisma migrate advisory-lock race — https://github.com/prisma/prisma-engines/issues/5755 ; https://github.com/prisma/prisma/issues/14454 ; k8s init-container migration pattern — https://oneuptime.com/blog/post/2026-01-30-kubernetes-init-container-patterns/view
6. Zero-downtime compose (rolling/blue-green) — https://oneuptime.com/blog/post/2026-01-06-docker-update-without-downtime/view ; https://sergeyku9nov.medium.com/zero-downtime-orchestration-with-docker-compose-rolling-blue-green-and-canary-deployments-b56ece457d9d ; https://jmh.me/blog/zero-downtime-docker-compose-deploy
7. Patroni HA — https://github.com/patroni/patroni ; CloudNativePG — https://oneuptime.com/blog/post/2026-02-09-postgresql-cloudnativepg-ha/view
8. Next.js standalone Dockerfile / alpine vs distroless sizes — https://www.buildwithmatija.com/blog/nextjs-standalone-dockerfile-guide ; https://github.com/coffeedome/distroless-nextjs ; https://oneuptime.com/blog/post/2026-01-16-docker-reduce-image-size/view
9. Zero-downtime with Compose (graceful shutdown/healthchecks) — https://www.maxcountryman.com/articles/zero-downtime-deployments-with-docker-compose
10. [pg-backup-cmp] PostgreSQL backup tools compared (WAL-G vs pgBackRest vs Barman) — https://dblog.co.kr/en/posts/postgresql-part-5 ; https://www.bytebase.com/blog/top-open-source-postgres-backup-solution/
11. [pgbackrest-gh] pgBackRest repo status (2026 maintenance scare → "will continue", v2.58.0) — https://github.com/pgbackrest/pgbackrest
12. [minio-maint] MinIO CE maintenance-mode analysis — https://www.futuriom.com/articles/news/minio-faces-fallout-for-stripping-features-from-web-gui/2025/06 ; https://pepitedata.com/2025/12/15/minio-community-edition-end-agpl/
