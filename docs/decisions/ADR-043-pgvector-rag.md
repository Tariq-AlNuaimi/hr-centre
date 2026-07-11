# ADR-043 — pgvector RAG substrate + pluggable embeddings seam

**Status:** Accepted (enterprise pivot, WS-5 AI layer, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-036 (the Claude-native `lib/ai` runtime, which explicitly
deferred RAG + embeddings) and ADR-006 (Vercel + Neon — Neon supports the pgvector
`vector` extension, so no new datastore is introduced).

## Context

ADR-036 landed the AI runtime skeleton (`lib/ai/*`) and named the deferred
follow-ons: `/scaffold-ai-endpoint`, the ai-eval gate, the AI-Quality pillar, and
**pgvector RAG + embeddings**. This ADR is that last item. A retrieval seam has two
pluggable pieces — the embeddings model (text → vector) and the vector store — and
both should be deploy-time config, not app-code diffs, mirroring how ADR-036 made
the LLM endpoint pure config.

Two constraints shape it:

- **No new datastore.** The template already mandates Postgres; Neon ships the
  `vector` extension. A dedicated vector DB (Pinecone/Weaviate/Qdrant) would add
  infrastructure for a capability Postgres can carry — the same reasoning that put
  the queue on pg-boss and the rate limiter on Postgres/Valkey.
- **No new heavy dep.** Voyage/Cohere ship Node SDKs, each >50KB (the Ask-before
  line) for what is a two-field REST POST. And a RAG framework
  (LangChain/LlamaIndex) brings opinionated chunking + store abstractions a seam
  doesn't need.

## Decision

1. **Embeddings are a `fetch()`-based pluggable seam** (`lib/ai/embeddings.ts`):
   `EmbeddingsProvider { embed(texts): Promise<number[][]>; dimensions }`, a
   `getEmbeddings()` factory selecting voyage|cohere|none by env
   (`EMBEDDINGS_PROVIDER`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL`,
   `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_DIMENSIONS`), and `isEmbeddingsConfigured()`.
   It is a **silent no-op until configured**, throwing `EmbeddingsNotConfiguredError`
   (named var, no partial-config leak) — the exact contract of `AiNotConfiguredError`
   (ADR-036) and the OTel/email degradations. Providers are thin REST wrappers, no
   vendor SDK; the endpoint is configurable, so a self-hosted/compat gateway is a
   deploy-time change.

2. **RAG is a thin pgvector seam** (`lib/ai/rag.ts`): `ragUpsert` / `ragQuery` over a
   raw `document_embedding` table, embedding via the seam and using **parameterized
   `$queryRaw`/`$executeRaw` only** (vector + metadata bound as params then cast
   `::vector` / `::jsonb`; never `$queryRawUnsafe`). Guarded by
   `isEmbeddingsConfigured()`; `k` clamped to [1,100] (Scalable pillar). Traced via
   `withSpan`.

3. **The vector table is SQL-only, not a Prisma model.** Prisma 7 has no first-class
   `vector` type; modeling the column forces `Unsupported("vector(1536)")`, which
   risks `prisma generate` / introspection drift. The migration
   (`20260711120000_pgvector_rag`) creates the extension, table, HNSW cosine index,
   and namespace index; `schema.prisma` is untouched. The table is intentionally
   outside the audit + soft-delete extensions (derived index data, not a
   system-of-record entity).

## Consequences

- A fork enables RAG with two env vars + one migration; no restructuring. Provider,
  endpoint, and model are all config.
- **UNVERIFIED in-session (accepted, logged).** There is no pgvector-enabled
  Postgres and no embeddings egress in the build environment, so the migration is
  **unapplied** and no provider round-trip ran. Like the WS-1 distroless image
  wave-off, verification is delegated to a fork/CI with the infrastructure. Logged in
  `docs/findings-register.md`; the fix at activation is: apply the migration against a
  pgvector Postgres, set an embeddings provider, and exercise `ragUpsert`/`ragQuery`.
- **Dimension coupling.** `vector(1536)` must match `EMBEDDINGS_DIMENSIONS`. voyage-3
  / embed-english-v3.0 emit 1024 — a fork on those must ALTER the column and set the
  env in lockstep. Documented in the migration + `lib/ai/embeddings.ts`.

## Alternatives considered

- **Vendor embedding SDKs** — rejected: >50KB Ask-before dep for a REST call;
  `fetch()` keeps the seam dep-free and endpoint-agnostic.
- **Dedicated vector DB** — rejected: new infrastructure vs. pgvector on the existing
  Neon Postgres.
- **Model the vector column in `schema.prisma`** — rejected: `Unsupported(...)` risk
  to `prisma generate`; SQL-only migration + raw parameterized queries is safer.
- **A RAG framework (LangChain/LlamaIndex)** — deferred: heavy, opinionated; a seam is
  the maintained surface, a fork composes chunking/re-ranking on top.
