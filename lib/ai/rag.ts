// lib/ai/rag.ts — a thin RAG seam over pgvector (ADR-043, WS-5).
//
// Retrieval-augmented generation, kept to the smallest maintained surface: embed
// text with the pluggable provider (lib/ai/embeddings.ts), store the vector in a
// pgvector column, and fetch top-k by cosine distance. This is a SEAM, not a
// framework -- no chunking policy, no re-ranking, no document store abstraction;
// a fork composes those on top when it needs them.
//
// Storage contract (UNAPPLIED/UNVERIFIED here -- see docs/findings-register.md):
// the `document_embedding` table + the `vector` extension must exist. They are
// created by prisma/migrations/*_pgvector_rag/migration.sql, which is authored but
// NOT applied in this environment (no pgvector DB, no embeddings egress). A fork
// verifies by running that migration against a pgvector-enabled Postgres (Neon
// supports the `vector` extension) and configuring an embeddings provider.
//
// Invariants honored:
//   - Prisma-only, server-side: uses the repo `prisma` client (CLAUDE.md).
//   - Parameterized $queryRaw / $executeRaw ONLY (tagged templates) -- never
//     $queryRawUnsafe. The embedding vector is bound as a param then cast
//     `::vector`; metadata is bound then cast `::jsonb`. No string interpolation
//     of user input into SQL (OWASP A03).
//   - Guarded by isEmbeddingsConfigured(): unconfigured => getEmbeddings() throws
//     EmbeddingsNotConfiguredError before any DB round-trip.
//
// The `document_embedding` table is a raw pgvector table, not a Prisma model, so
// it is outside the audit + soft-delete extensions by design (it holds derived
// index data, not a system-of-record entity).

import { withSpan } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

import { getEmbeddings, isEmbeddingsConfigured } from "./embeddings";

/** JSON-serializable metadata stored alongside a RAG row. */
export type RagMetadata = Record<string, unknown>;

/** One hit from {@link ragQuery}: the stored row + its cosine distance (lower = closer). */
export interface RagHit {
  id: string;
  namespace: string;
  content: string;
  metadata: RagMetadata | null;
  /** pgvector cosine distance in [0,2]; 0 = identical direction. */
  distance: number;
}

/** Render a numeric vector as the pgvector text literal `[a,b,c]` for a bound `::vector` cast. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Embed `text` and upsert it under (`namespace`, `id`). Re-upserting the same
 * (namespace,id) replaces content/embedding/metadata (idempotent). Throws
 * {@link EmbeddingsNotConfiguredError} before any DB write when embeddings are
 * unconfigured. Requires the `document_embedding` table (see the migration).
 */
export async function ragUpsert(
  namespace: string,
  id: string,
  text: string,
  metadata?: RagMetadata,
): Promise<void> {
  const [embedding] = await embed([text]);
  const vec = toVectorLiteral(embedding);
  // metadata bound as a JSON string then cast ::jsonb -- never interpolated.
  const meta = metadata ? JSON.stringify(metadata) : null;
  await withSpan("rag.upsert", async () => {
    await prisma.$executeRaw`
      INSERT INTO "document_embedding" ("namespace", "id", "content", "embedding", "metadata")
      VALUES (${namespace}, ${id}, ${text}, ${vec}::vector, ${meta}::jsonb)
      ON CONFLICT ("namespace", "id") DO UPDATE SET
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "metadata" = EXCLUDED."metadata"
    `;
  });
}

/**
 * Embed `queryText` and return the top-`k` rows in `namespace` by cosine distance
 * (ascending — closest first). Throws {@link EmbeddingsNotConfiguredError} before
 * any DB read when embeddings are unconfigured. `k` is clamped to [1,100] so a
 * caller can't request an unbounded result set (Scalable pillar).
 */
export async function ragQuery(
  namespace: string,
  queryText: string,
  k = 5,
): Promise<RagHit[]> {
  const limit = Math.min(Math.max(Math.trunc(k) || 1, 1), 100);
  const [embedding] = await embed([queryText]);
  const vec = toVectorLiteral(embedding);
  return withSpan("rag.query", async () => {
    const rows = await prisma.$queryRaw<RagHit[]>`
      SELECT
        "id",
        "namespace",
        "content",
        "metadata",
        ("embedding" <=> ${vec}::vector) AS "distance"
      FROM "document_embedding"
      WHERE "namespace" = ${namespace}
      ORDER BY "embedding" <=> ${vec}::vector
      LIMIT ${limit}
    `;
    return rows;
  });
}

/** Shared guard + embed step for upsert/query. Fails fast when unconfigured. */
async function embed(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingsConfigured()) {
    // getEmbeddings() throws EmbeddingsNotConfiguredError -- named-var, no leak.
    getEmbeddings();
  }
  const vectors = await getEmbeddings().embed(texts);
  return vectors;
}
