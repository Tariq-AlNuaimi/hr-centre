# C02 — Data: ORM, Postgres, migrations, pooling, vector, backup

> Exhaustive 4-lens top-10 benchmark. Ground truth (from `package.json`, per METHODOLOGY): **Prisma 7.7 + `@prisma/adapter-pg` + `pg` 8 · PostgreSQL 17 · no vector store · no pooler · no backup tooling**. Pivot honored throughout: **self-hosted dockerized Postgres is the default, deploy-per-tenant** (each tenant = its own DB/container; no in-app row-level multi-tenancy). Stars/versions/licenses verified 2026-07; see `Sources`.
> Lens tags: `BT`=battle-tested · `HS`=highest-star/popular · `ENT`=enterprise-grade · `OSS`=best permissive self-hostable.

---

### prisma@7 (+ @prisma/client, @prisma/adapter-pg)

**One line.** Schema-first TypeScript ORM; our current, primary data-access layer (v7.7). KEEP question below.

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **Prisma 7** | BT·HS·ENT | ~45k [1][2] | Apache-2.0 | 2019; v7.0 2025-11-19 | Rust-free WASM query compiler on the JS main thread → ~3× faster queries, ~9× faster cold start vs v6; biggest DX + ecosystem; migrations, Studio, typed client [1] |
| 2 | Drizzle ORM | HS·OSS | ~32k [3] | Apache-2.0 | 2022 | SQL-first, ~7.4 KB gzip, zero runtime deps, best serverless/edge cold-start; code-first TS schema [3] |
| 3 | Kysely | OSS | ~14k [4] | MIT | 2022 | Type-safe SQL query builder (not a full ORM); the "escape hatch" layer; pairs under other ORMs [4] |
| 4 | TypeORM | BT | ~35k [5] | MIT | 2016; **v1.0 2026-06** | Decorator/Data-Mapper+AR; renewed maintenance in 2025 (575 PRs vs 63), exited pre-1.0 after 8 yrs [5] |
| 5 | MikroORM | OSS | ~8k | MIT | 2018 | Data-Mapper + Unit-of-Work + Identity-Map; strongest for complex domain models; now ships a Kysely bridge |
| 6 | Sequelize | BT | ~30k | MIT | 2011; v7 beta | Oldest, huge install base (~2M dl/wk); "maintained, not evolving"; v7 adds TS-native but plays catch-up |
| 7 | raw `pg` + SQL | BT·OSS | (see pg item) | MIT | 2010 | Zero abstraction; max control/perf, zero type-safety without a builder |
| 8 | ZenStack | OSS | ~2k | MIT | 2023 | Prisma-superset adding access-policy/ReBAC in-schema; interesting for C04, not a base ORM swap |

**Head-to-head.** The Prisma-7 rewrite neutralizes the two historical reasons to leave: the Rust engine binary is gone (pure-TS/WASM) and cold-start/bundle penalties dropped sharply, so Drizzle's core edge shrinks to the serverless-edge niche we don't target (deploy-per-tenant = a long-lived container, not a cold Lambda). Drizzle still wins raw SQL transparency and bundle size; Kysely is a builder, not a migrations/ORM story, so it complements rather than replaces. TypeORM's 1.0 and Sequelize's v7 are recoveries, not reasons to migrate a green Prisma codebase. Our whole harness (10 ESLint rules, `no-prisma-in-client`, audit + soft-delete Prisma client extensions, `/scaffold-entity`) is Prisma-shaped; a swap would rewrite the invariant layer for no enterprise gain.

**Recommendation: KEEP+HARDEN** — Fit **5/5**. Stay on Prisma 7; the v7 rewrite is a strict upgrade to the exact axes (cold start, no native binary in the image) that matter for Docker-first self-host. Harden: pin the `driverAdapters`/`@prisma/adapter-pg` path (already set), keep `prisma migrate deploy` in the release path (see migration item), and adopt v7.4 client caching only behind a measured need. **ADR impact:** none (reaffirms ADR-001 locked stack); note v7 as a confirming data point.

---

### pg@8 (node-postgres driver)

**One line.** The Postgres wire driver under `@prisma/adapter-pg`; current `pg@8.22`. 

| # | Candidate | Lens | Version (2026-07) | License | Why it ranks |
|---|-----------|------|-------------------|---------|--------------|
| 1 | **`pg` (node-postgres)** | BT·HS·OSS | 8.22.0 [6] | MIT | De-facto Node PG driver; what `@prisma/adapter-pg` wraps; huge battle-tested surface [6] |
| 2 | `postgres` (porsager) | HS·OSS | 3.x | Unlicense | Faster tagged-template client, smaller; but Prisma adapter targets `pg` |
| 3 | `@neondatabase/serverless` | ENT | 1.x | MIT | HTTP/WS driver for edge; only if Neon-hosted (optional, not the self-host default) |

**Head-to-head.** For a self-hosted TCP Postgres, `pg` is the correct and only well-supported adapter target for Prisma 7's `@prisma/adapter-pg`. `postgres`/porsager is faster in microbenchmarks but off the Prisma-supported path; the Neon serverless driver only earns its keep on Neon (our optional, not default, host).

**Recommendation: KEEP** — Fit **5/5**. No change. Watch the pinned range in-line per ADR-017; `pg@8` is the supported floor. **ADR impact:** none.

---

### PostgreSQL container image

**One line.** The database engine image for the self-hosted default — NET-NEW as a *pinned image choice* (repo config references PG **17**, but PG **18** is now the stable line).

| # | Candidate | Lens | Latest (2026-07) | License | Why it ranks |
|---|-----------|------|------------------|---------|--------------|
| 1 | **`postgres` (official Docker)** | BT·HS·OSS | 18.x / 17.x [7] | PostgreSQL (permissive) | Canonical, Debian+Alpine variants, `docker-entrypoint-initdb.d`, universally supported |
| 2 | **`pgvector/pgvector`** | OSS | pg17/pg18 + pgvector | PostgreSQL | Official image = base Postgres **with the `vector` extension prebuilt**; our chosen vector path (below) |
| 3 | `timescale/timescaledb` | ENT | pg17 | Apache-2.0 core / **TSL** for advanced | Time-series; advanced features are TSL-restricted (anti-cloud license) — avoid unless doing time-series |
| 4 | `bitnami/postgresql` | — | legacy | — | **AVOID — see current-events catch**: free images deprecated 2025-08-28, moved to `bitnamilegacy` (no updates); "Secure" tier is paid ($50–72k/yr) [8] |
| 5 | `cloudnative-pg` images | ENT | pg18 | Apache-2.0 | Operator-managed HA images — k8s-era; out of scope (compose-now / no-k8s-v1 pivot) |

**Head-to-head.** For a compose-first, deploy-per-tenant world the choice is the **official `postgres` image, or `pgvector/pgvector` when a tenant needs embeddings** (it *is* the official image plus the extension — no functionality lost, so it can be the single default). Bitnami — historically a common "batteries-included" pick — is now a trap: Broadcom moved the free catalog to a frozen `bitnamilegacy` repo (Aug/Sep 2025) and gated patched images behind a five-figure subscription; any inherited compose file referencing `bitnami/postgresql` should be migrated. Timescale is only worth its TSL license friction for genuine time-series; not our case.

**Recommendation: ADOPT (net-new) → `pgvector/pgvector:pg18` as the pinned default; bump the repo's PG 17 reference to 18.** Fit **5/5**. PG 18 (2025-09-25) adds async I/O (io_uring) with up to ~3× read throughput [7] — a free win for self-hosted OLTP. Using the pgvector image as the base costs nothing when vectors are unused and removes a later image swap. **Current-events catch:** never adopt `bitnami/postgresql`. **ADR impact:** new ADR "self-hosted Postgres image + version policy" (pin `pgvector/pgvector:pg18`, forward-compatible-migrations rule already in CLAUDE.md).

---

### Connection pooler (NET-NEW)

**One line.** No pooler today (Prisma pools per-process in-memory). NET-NEW for HA / many app replicas per tenant.

| # | Candidate | Lens | Stars/Status (2026-07) | License | Why it ranks |
|---|-----------|------|------------------------|---------|--------------|
| 1 | **PgBouncer** | BT·HS·OSS | de-facto standard [9][11] | ISC (BSD-style) | Single ~C binary, ~2 MB RAM/1k clients, lowest latency at low-moderate conns; universal [9] |
| 2 | **PgCat** | OSS | Rust rewrite [10][11] | MIT | PgBouncer-compatible + read/write split, sharding, config-as-code; higher tps past ~50 conns (~59k vs ~44k) [11] |
| 3 | Supavisor | OSS | Supabase, Elixir [9] | Apache-2.0 | Scales to 100k+ conns, multi-tenant/serverless-oriented; heavier runtime (BEAM) |
| 4 | Prisma Accelerate | ENT | SaaS | proprietary | Managed global pool+cache; **hosted lock-in, egress dependency** — contradicts self-host/air-gap default [2] |
| 5 | pgpool-II | BT | mature | BSD-style | Pooling + LB + replication mgmt; heavier/more complex than needed per-tenant |

**Head-to-head.** Deploy-per-tenant means one modest Postgres per tenant fronting a small, fixed number of app replicas — exactly PgBouncer's sweet spot (lowest latency until you cross ~50–75 conns) and it deploys as a tiny compose sidecar with zero external dependency. PgCat is the upgrade path *if* a tenant needs read-replica routing or sharding, and is drop-in compatible. Supavisor's 100k-connection design solves a problem deploy-per-tenant intentionally doesn't have. Prisma Accelerate is off the table for the self-hosted/air-gap default (SaaS egress + lock-in). **Prisma-specific trap:** in transaction-pooling mode, Prisma's named prepared statements can break across rotated backends — set `?pgbouncer=true` (or `pgcat` equivalent) on the pooled URL and keep migrations on a **direct** (unpooled) connection [9].

**Recommendation: ADD-AS-OPTION → PgBouncer sidecar (default when >1 app replica), PgCat as the read-split/shard upgrade.** Fit **5/5**. For single-replica tenants, Prisma's built-in pool is fine — don't add a pooler by reflex. **ADR impact:** new ADR "connection pooling for self-host" documenting the `pgbouncer=true` + direct-URL-for-migrations rule and the PgBouncer→PgCat escalation. Never Prisma Accelerate under the self-host default.

---

### Vector store (NET-NEW)

**One line.** No vector store yet. NET-NEW for the Claude-first AI/RAG stack (cross-ref C07).

| # | Candidate | Lens | Stars (2026-07) | License | Why it ranks |
|---|-----------|------|-----------------|---------|--------------|
| 1 | **pgvector** | BT·OSS | ~21–22k [12] | **PostgreSQL** (permissive) | Vectors *inside* Postgres — one DB, one backup, one connection, transactional with app data; ideal <10M vectors [12] |
| 2 | **pgvectorscale** | OSS | Timescale | **PostgreSQL/Apache-2.0** (OSS, not TSL) [13] | DiskANN + compression on top of pgvector; ~$835 vs Pinecone ~$3.2k/mo at 50M vecs; stays in-Postgres [13] |
| 3 | Qdrant | HS·OSS | ~32.6k [14] | Apache-2.0 | Rust, best filtered-search latency (p50 ~4ms), self-host-friendly [14] |
| 4 | Milvus | HS·ENT | ~42–43k [14][15] | Apache-2.0 | Billion-vector scale, mature sharding; heavy multi-service footprint |
| 5 | Weaviate | OSS·ENT | ~13k | BSD-3 | Built-in hybrid (BM25+vector), vectorizer modules, managed cloud option |
| 6 | Chroma | HS·OSS | ~28.6k [14] | Apache-2.0 | Fastest prototyping DX; less proven at large prod scale |
| 7 | Pinecone | ENT | proprietary SaaS | closed | Fully managed; **no self-host / air-gap** — fails the pivot |
| 8 | FAISS (lib) | BT·OSS | ~35k | MIT | Library, not a server; a building block, not a store |

**Head-to-head.** With deploy-per-tenant + self-hosted Postgres already present, **pgvector is the default that adds zero new infrastructure**: embeddings live beside app rows, share the same container/backup/pooler, and stay transactional and RBAC-scoped — no second datastore to secure per tenant. It comfortably covers the internal-tool corpus sizes we target (<10M vectors). If a tenant's corpus outgrows pgvector's recall/latency, **pgvectorscale** (OSS-licensed DiskANN, *not* the restrictive TSL) is an in-place extension upgrade — no data migration off Postgres. A dedicated store (Qdrant best-in-class filtered latency; Milvus for billion-scale) is only justified at a scale internal tools rarely hit, and each adds a per-tenant service to deploy, secure, and back up. Pinecone is excluded by the self-host/air-gap requirement.

**Recommendation: ADOPT (net-new) → pgvector (default), pgvectorscale (in-place scale upgrade), Qdrant (documented escape hatch >10M vecs or heavy filtered search).** Fit **5/5** — reuses the existing DB, one backup domain, no new trust boundary. **ADR impact:** new ADR "vector store = pgvector-in-Postgres" tied to the `pgvector/pgvector:pg18` image choice; C07 references it.

---

### Backup / PITR (NET-NEW)

**One line.** No backup/PITR tooling in the repo. NET-NEW and mandatory for enterprise self-host. **Contains the category's biggest current-events catch.**

| # | Candidate | Lens | Status (2026-07) | License | Why it ranks |
|---|-----------|------|------------------|---------|--------------|
| 1 | **WAL-G** | BT·OSS | active, Go [16] | Apache-2.0 | Object-storage-first (S3/MinIO), parallel backup+restore, PITR; cloud/container-native — best fit for Docker+MinIO [16][17] |
| 2 | **Barman** | BT·ENT | active, v3.18 2026-03 [16] | GPL-3 | EDB-backed, mature, centralized multi-instance mgmt; the mainstream "pgBackRest refugee" target [16][17] |
| 3 | pgBackRest | BT | **UNMAINTAINED since 2026-04** [17][18] | MIT | Was the de-facto standard (block-level incrementals); maintainer stepped back — **new adoptions discouraged** [17][18] |
| 4 | Volume/filesystem snapshots | BT·OSS | n/a | infra | Cheap crash-consistent snapshots; **not PITR**, no WAL replay — coarse RPO; a complement, not the plan |
| 5 | pg_probackup | OSS | active | BSD-style | Incremental + validation; smaller community, less container tooling |
| 6 | `pg_basebackup` + WAL archiving | BT·OSS | core tool | PostgreSQL | Zero-dep baseline for a single small cluster; manual scripting for PITR |

**Head-to-head.** **Current-events catch (high-value):** pgBackRest — long the default recommendation — was declared **unmaintained as of April 2026** by maintainer David Steele; it still runs and existing installs are fine, but starting *new* enterprise infra on it is a liability, and even its author now points elsewhere [17][18]. For our Docker-first, MinIO-in-C09, deploy-per-tenant model, **WAL-G is the natural default**: it was designed around object storage, does parallel backup/restore, gives true PITR via WAL archiving, and drops cleanly into a compose sidecar pointed at MinIO/S3. **Barman** is the on-prem/DBA-team alternative (centralized management of many instances, corporate backing) but is heavier and streaming-replication-oriented. Volume snapshots are a useful cheap *second* layer (fast whole-volume rollback) but are not PITR and must not be the only plan.

**Recommendation: ADOPT (net-new) → WAL-G (default, → MinIO/S3) + volume snapshots as a cheap secondary; Barman as the multi-instance/on-prem alternative. Do NOT adopt pgBackRest.** Fit **5/5** with the Docker+object-storage direction. **ADR impact:** new ADR "backup & PITR = WAL-G to object storage" documenting per-tenant backup isolation, RPO/RTO targets, and the explicit pgBackRest exclusion with its 2026-04 unmaintained rationale.

---

### Migration-at-startup pattern (NET-NEW)

**One line.** How `prisma migrate deploy` runs on release in the Docker-first world. NET-NEW as a codified pattern.

| # | Pattern | Lens | Fit | Why it ranks |
|---|---------|------|-----|--------------|
| 1 | **Entrypoint chain** (`migrate deploy && node server.js`) | BT | simple | One container, guaranteed pre-boot migration; simplest [19] |
| 2 | **Separate migration job / init-container** | BT·ENT | best for multi-replica | Runs once before app replicas start → no migration race across replicas; smaller app image (no Prisma CLI) [19] |
| 3 | Build-time migration | — | anti-pattern | `migrate deploy` at build has no DB; never run migrations in the image build [19] |
| 4 | Vercel-style `buildCommand` migrate | — | host-specific | Current `vercel.json` runs `prisma migrate deploy` per build — fine for Neon-optional, not the self-host path |

**Head-to-head.** With deploy-per-tenant, most tenants run a single app replica, where the **entrypoint chain is perfectly safe and the least moving parts**. The failure mode to design against is *multiple app replicas racing the same migration* and *orchestrators killing a container mid-migration* (leaving it marked in-progress) — both solved by a **dedicated one-shot migration job/init-container** that must succeed before app replicas boot. Prisma's own guidance: keep `migrate deploy` in an automated release step, run it against a **direct (unpooled) connection**, never at image-build time [19].

**Recommendation: ADOPT (net-new) → default to the entrypoint chain for single-replica tenants; use a dedicated compose migration job (init-container) when a tenant scales to >1 app replica. Always migrate over a direct URL.** Fit **5/5**. **ADR impact:** new ADR (or fold into the deploy ADR) codifying: migration job pattern, direct-connection rule, forward-compatible-only migrations (already a CLAUDE.md invariant — `vercel.json` runs migrate on every build), and never-migrate-at-build.

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|------------|----------|
| Prisma 7 ORM | `prisma@7.7` | **KEEP+HARDEN** | — | Reaffirms ADR-001 | P2 |
| `pg` driver | `pg@8.22` | **KEEP** | — | none | P2 |
| Postgres image | ref PG 17 | **ADOPT → `pgvector/pgvector:pg18`** (bump 17→18; avoid Bitnami) | pinned image | New: image+version policy | **P0** |
| Connection pooler | none (in-proc) | **ADD-AS-OPTION → PgBouncer** (PgCat for read-split); never Accelerate | `pgbouncer` sidecar | New: self-host pooling | P1 |
| Vector store | none | **ADOPT → pgvector** (pgvectorscale scale-up; Qdrant escape hatch) | `vector` ext (in image) | New: vector-in-Postgres | P1 |
| Backup / PITR | none | **ADOPT → WAL-G + snapshots** (Barman alt); **NOT pgBackRest** | `wal-g` sidecar | New: backup & PITR | **P0** |
| Migration-at-startup | Vercel build-cmd | **ADOPT → entrypoint (1-replica) / migration job (multi)**; direct URL | — | New/fold into deploy ADR | **P0** |

---

## Sources

1. Prisma — "Announcing Prisma ORM 7.0.0 (Rust-Free, Faster)" — prisma.io/blog/announcing-prisma-orm-7-0-0 (v7.0 2025-11-19; ~3× queries, ~9× cold start)
2. Prisma Docs — changelog / Accelerate compare — prisma.io/changelog, prisma.io/docs/accelerate/compare (v7.7 current; ~45k stars)
3. makerkit / tech-insider / encore — "Drizzle vs Prisma 2026" (Drizzle ~32k stars, ~900k dl/wk, ~7.4 KB gzip, Apache-2.0)
4. github.com/kysely-org/kysely — Kysely ~14k stars, MIT (2026-07)
5. InfoQ / typeorm.io — "TypeORM Reaches 1.0" 2026-06 (renewed maintenance, MIT, ~2M dl/wk)
6. npmjs.com/package/pg + node-postgres CHANGELOG — `pg@8.22.0`, MIT (2026-07)
7. postgresql.org — "PostgreSQL 18 Released" 2025-09-25 (async I/O / io_uring, up to ~3× read throughput); Phoronix coverage
8. Northflank / The New Stack / bitnami issue #83267 — Bitnami free catalog → `bitnamilegacy` (2025-08-28, deletion delayed to 2025-09-29); Secure tier ~$50–72k/yr
9. Prisma Docs — "Configure Prisma Client with PgBouncer" (prepared-statement caveat, `?pgbouncer=true`, direct URL for migrations)
10. github.com/postgresml/pgcat — PgCat, Rust, MIT
11. Tembo — "Benchmarking PostgreSQL connection poolers: PgBouncer, PgCat, Supavisor" (PgBouncer ~44k tps peak; PgCat ~59k tps, better past ~50 conns)
12. github.com/pgvector/pgvector — ~21–22k stars, PostgreSQL license (permissive)
13. github.com/timescale/pgvectorscale — DiskANN extension, **OSS (PostgreSQL/Apache-2.0) — not TSL**; ~$835 vs Pinecone ~$3.2k/mo @ 50M vectors
14. openalternative / localaimaster / firecrawl (2026) — Qdrant ~32.6k (Apache-2.0), Chroma ~28.6k (Apache-2.0), Milvus ~42–43k (Apache-2.0), Weaviate BSD-3, Pinecone proprietary SaaS
15. Firecrawl / MarkTechPost — "Best Vector Databases 2026" (Milvus billion-scale; Qdrant p50 ~4ms filtered)
16. dblog.co.kr / Severalnines — "pgBackRest vs Barman vs WAL-G 2026" (Barman v3.18 2026-03, GPL-3, EDB; WAL-G Go/Apache-2.0, object-storage-first)
17. Christophe Pettus (thebuild.com) — "After pgBackRest" 2026-04-30 (**pgBackRest unmaintained**; recommends WAL-G for cloud/S3, Barman on-prem)
18. dev.to/kunal — "pgBackRest Is No Longer Maintained: 3 PostgreSQL Backup Tools Compared [2026]"
19. Prisma Docs — "Deploy database changes with Prisma Migrate" + "How to use Prisma in Docker"; notiz.dev — entrypoint vs init-container migration (`migrate deploy && node server.js`; separate job avoids multi-replica race; never at build)
