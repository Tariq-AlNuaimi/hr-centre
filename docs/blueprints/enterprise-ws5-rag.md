Scope: lib/ai/rag.ts, lib/ai/embeddings.ts

# Blueprint — Enterprise WS-5: pgvector RAG substrate + pluggable embeddings

> Governs the WS-5 RAG seam (ADR-043). It adds NO new `app/api/**/route.ts` or
> `app/**/page.tsx` (seam-only), so `blueprint-gate.mjs` (ADR-033) does not fire;
> this file is the requirements contract `/qa`/`/uat` trace against, and it refines
> AC-6.1 of `docs/blueprints/enterprise-p0-baseline.md` (whose `Scope:` covers
> `lib/ai/**`). Build-vs-buy recorded in `docs/build-vs-buy-ledger.md`
> (2026-07-11 — embeddings seam). Decision of record: **ADR-043**.

## Problem & outcome
ADR-036 landed the AI runtime but explicitly deferred RAG + embeddings. This
increment adds the smallest maintained retrieval seam: a pluggable embeddings
provider (`lib/ai/embeddings.ts`) and a thin pgvector store/query pair
(`lib/ai/rag.ts`), plus the SQL migration that creates the vector table. Like the
rest of `lib/ai/*` it is a **silent no-op until configured** — no
`EMBEDDINGS_API_KEY`, no provider, and `getEmbeddings()` throws a named-var error
instead of half-initializing.

## Market scan
- **Vector store:** pgvector (rides the mandatory Postgres — no new datastore) vs.
  Pinecone/Weaviate/Qdrant (SaaS/self-host infra). Chose pgvector: Neon supports
  the `vector` extension; zero new infrastructure; matches the "no new datastore"
  line that also picked pg-boss and Postgres-backed rate limiting.
- **Embeddings SDK:** Voyage / Cohere ship Node SDKs, but each is a >50KB dep behind
  the Ask-before gate for a two-field REST call. Chose thin `fetch()` wrappers,
  endpoint-configurable — same "wire-native, endpoint is config" stance as the
  Claude provider (ADR-036). LangChain/LlamaIndex RAG frameworks: deferred (heavy,
  opinionated chunking/store abstractions we don't need for a seam).

## User stories
- As a fork operator, I set `EMBEDDINGS_PROVIDER=voyage` + `EMBEDDINGS_API_KEY`, run
  the migration, and `ragUpsert(ns, id, text)` / `ragQuery(ns, q, k)` work — no code
  change to switch provider or endpoint.
- As a template maintainer, a fork that ships no RAG sees zero `/ship` effect and no
  dead checklist — the seam is inert until configured.

## Scenarios
- **Happy:** provider configured + table applied → upsert embeds & stores; query
  embeds & returns top-k by cosine distance ascending.
- **Worst / unconfigured:** no key → `isEmbeddingsConfigured()` false;
  `getEmbeddings()` and both RAG fns throw `EmbeddingsNotConfiguredError` (named var)
  before any DB round-trip. Provider 4xx/5xx → `embed()` throws with the status, no
  key leaked. `k` out of range → clamped to [1,100] (no unbounded reads).
- **Boundary:** dimension mismatch between `EMBEDDINGS_DIMENSIONS` and the
  `vector(1536)` column → INSERT fails loud (documented, not silent).

## Architecture sketch
`EmbeddingsProvider { embed(texts):Promise<number[][]>; dimensions }` factory
selects voyage|cohere|none by env at call time. `lib/ai/rag.ts` embeds via that
provider and reads/writes the raw `document_embedding` pgvector table through the
repo `prisma` client using **parameterized `$queryRaw`/`$executeRaw` only** (vector
bound then `::vector`, metadata bound then `::jsonb`; never `$queryRawUnsafe`).
Traced with `withSpan`. The table is SQL-only (not a Prisma model) to avoid
`Unsupported("vector(1536)")` risk in `prisma generate`.

## Tier & open questions
- Tier: personal (this repo); seam is shared-safe (security floor honored: zod-free
  because no HTTP boundary here; the consuming route adds zod).
- **UNVERIFIED (open):** no pgvector DB + no embeddings egress in-session, so the
  migration is unapplied and no provider round-trip ran. Verification is
  fork/CI-activated — see `docs/findings-register.md`. Highest-risk unknown a fork
  confirms: pgvector `vector`/`<=>` + HNSW index available on the target Postgres,
  and the chosen model's dimension matches the column.
