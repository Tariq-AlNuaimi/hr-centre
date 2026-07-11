-- pgvector RAG substrate (ADR-043, WS-5). UNAPPLIED / UNVERIFIED in-session:
-- there is no pgvector-enabled Postgres in the build environment, so this
-- migration was authored to spec but NOT run here. A fork applies it via the
-- normal `prisma migrate deploy` (vercel.json runs it every build) against a
-- Postgres that supports the `vector` extension (Neon does). See
-- docs/findings-register.md for the wave-off.
--
-- The `document_embedding` table is a raw pgvector index table, intentionally
-- NOT a Prisma model in schema.prisma: Prisma 7 has no first-class `vector`
-- type, so modeling the column would force `Unsupported("vector(1536)")`, which
-- risks `prisma generate` / introspection drift. Keeping it SQL-only avoids that
-- and keeps the vector column out of the audit + soft-delete extensions (it holds
-- derived index data, not a system-of-record entity). lib/ai/rag.ts reaches it
-- through parameterized $queryRaw / $executeRaw only.

-- pgvector: provides the `vector` column type + distance operators (<=> cosine).
CREATE EXTENSION IF NOT EXISTS vector;

-- The embedding store. vector(1536) MUST match EMBEDDINGS_DIMENSIONS in
-- lib/ai/embeddings.ts (default 1536). If a fork uses a model with a different
-- dimension (voyage-3 / embed-english-v3.0 emit 1024), ALTER this column AND set
-- EMBEDDINGS_DIMENSIONS in lockstep -- a mismatch fails the INSERT.
CREATE TABLE IF NOT EXISTS "document_embedding" (
  "namespace"  TEXT NOT NULL,
  "id"         TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "embedding"  vector(1536) NOT NULL,
  "metadata"   JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_embedding_pkey" PRIMARY KEY ("namespace", "id")
);

-- Approximate-nearest-neighbor index for cosine distance (the `<=>` operator
-- lib/ai/rag.ts orders by). HNSW is the pgvector default for recall/speed; it is
-- built per-namespace filtering via the WHERE + ORDER BY. `lists`/`m` left at
-- pgvector defaults -- tune per corpus size at scale.
CREATE INDEX IF NOT EXISTS "document_embedding_embedding_cosine_idx"
  ON "document_embedding"
  USING hnsw ("embedding" vector_cosine_ops);

-- Namespace lookup index (the equality filter that precedes the ANN order-by).
CREATE INDEX IF NOT EXISTS "document_embedding_namespace_idx"
  ON "document_embedding" ("namespace");
