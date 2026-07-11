// lib/ai/embeddings.ts — the pluggable embeddings seam for RAG (ADR-043, WS-5).
//
// A vector-embeddings provider is the one piece of a RAG stack that is genuinely
// pluggable: the model that turns text -> a fixed-dimension float vector is a
// deploy-time choice (Voyage, Cohere, a self-hosted endpoint), not an app-code
// diff. This module is that seam. It mirrors lib/ai/config.ts EXACTLY: a silent
// no-op unless EMBEDDINGS_API_KEY is set -- isEmbeddingsConfigured() is false and
// getEmbeddings() throws an actionable EmbeddingsNotConfiguredError rather than
// building a client that would 401 at call time (same contract as
// AiNotConfiguredError + the OTel no-op + email {sent:false}).
//
// Like lib/ai/config.ts this reads process.env DIRECTLY (not the zod-parsed
// lib/env) so the gate evaluates at CALL time. Providers are thin fetch() calls
// to each vendor's REST API -- NO new dependency (ADR-043 build-vs-buy) -- with
// the endpoint configurable (EMBEDDINGS_BASE_URL) so a self-hosted / compat
// gateway is a deploy-time change, never a diff.
//
// UNVERIFIED (see docs/findings-register.md): there is no embeddings egress in
// the build environment, so no provider round-trip has been exercised. The shapes
// below track each vendor's documented REST contract; a fork with a key confirms.

/** Which embeddings backend to construct. "none" (or unset) => the no-op gate. */
export type EmbeddingsProviderName = "voyage" | "cohere" | "none";

/** Default embedding model per provider when EMBEDDINGS_MODEL is unset. */
const DEFAULT_MODEL: Record<Exclude<EmbeddingsProviderName, "none">, string> = {
  voyage: "voyage-3",
  cohere: "embed-english-v3.0",
};

/** Default REST endpoint per provider when EMBEDDINGS_BASE_URL is unset. */
const DEFAULT_BASE_URL: Record<Exclude<EmbeddingsProviderName, "none">, string> = {
  voyage: "https://api.voyageai.com/v1/embeddings",
  cohere: "https://api.cohere.ai/v1/embed",
};

/**
 * Default vector dimension. MUST match the pgvector column in
 * prisma/migrations/*_pgvector_rag/migration.sql (vector(1536)). Override with
 * EMBEDDINGS_DIMENSIONS only in lockstep with an ALTER of that column -- a
 * mismatch fails the INSERT, not silently. voyage-3/embed-english-v3.0 emit 1024;
 * set EMBEDDINGS_DIMENSIONS + a matching column, or use a 1536-dim model.
 */
const DEFAULT_DIMENSIONS = 1536;

/**
 * A pluggable embeddings backend. `embed` maps N input strings -> N vectors (row
 * order preserved); `dimensions` is the fixed vector length every row carries and
 * the pgvector column must be declared with.
 */
export interface EmbeddingsProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/** Resolved embeddings config (only valid when configured). */
interface EmbeddingsConfig {
  provider: Exclude<EmbeddingsProviderName, "none">;
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
}

/** The raw provider selector from env (unvalidated beyond the enum coerce). */
function providerName(): EmbeddingsProviderName {
  const raw = process.env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  if (raw === "voyage" || raw === "cohere") return raw;
  return "none";
}

/**
 * True when the embeddings seam has the two things it cannot default: a concrete
 * provider (voyage|cohere, not "none") AND an EMBEDDINGS_API_KEY. This is the ONLY
 * gate that decides whether a provider will construct -- route every consumer
 * (lib/ai/rag.ts) through here so the "no key => no client" invariant has one
 * definition, mirroring isAiConfigured().
 */
export function isEmbeddingsConfigured(): boolean {
  if (providerName() === "none") return false;
  const key = process.env.EMBEDDINGS_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/** Resolve config or throw {@link EmbeddingsNotConfiguredError}. Internal. */
function embeddingsConfig(): EmbeddingsConfig {
  const provider = providerName();
  const apiKey = process.env.EMBEDDINGS_API_KEY;
  if (provider === "none" || !apiKey || apiKey.trim().length === 0) {
    throw new EmbeddingsNotConfiguredError();
  }
  const model = process.env.EMBEDDINGS_MODEL?.trim();
  const baseUrl = process.env.EMBEDDINGS_BASE_URL?.trim();
  const dimsRaw = process.env.EMBEDDINGS_DIMENSIONS?.trim();
  const dims = dimsRaw && dimsRaw.length > 0 ? Number(dimsRaw) : DEFAULT_DIMENSIONS;
  return {
    provider,
    apiKey,
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URL[provider],
    model: model && model.length > 0 ? model : DEFAULT_MODEL[provider],
    dimensions: Number.isFinite(dims) && dims > 0 ? dims : DEFAULT_DIMENSIONS,
  };
}

/**
 * The configured embeddings provider, or throws {@link EmbeddingsNotConfiguredError}
 * when unconfigured -- call {@link isEmbeddingsConfigured} first to branch without
 * throwing. Reads env at call time, so switching provider/endpoint/model is a
 * deploy-time change. Providers are thin fetch() wrappers (no vendor SDK dep).
 */
export function getEmbeddings(): EmbeddingsProvider {
  const cfg = embeddingsConfig();
  return cfg.provider === "voyage" ? voyageProvider(cfg) : cohereProvider(cfg);
}

/** Voyage AI REST provider: POST {input, model} -> {data:[{embedding,index}]}. */
function voyageProvider(cfg: EmbeddingsConfig): EmbeddingsProvider {
  return {
    dimensions: cfg.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = await fetch(cfg.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Restricted: the key rides Authorization; never logged (CLAUDE.md).
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ input: texts, model: cfg.model }),
      });
      if (!res.ok) {
        throw new Error(`embeddings: voyage request failed (${res.status})`);
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
      };
      const rows = json.data ?? [];
      // Order by the returned index so row order matches the input order.
      return [...rows].sort((a, b) => a.index - b.index).map((r) => r.embedding);
    },
  };
}

/** Cohere REST provider: POST {texts, model, input_type} -> {embeddings:[[...]]}. */
function cohereProvider(cfg: EmbeddingsConfig): EmbeddingsProvider {
  return {
    dimensions: cfg.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = await fetch(cfg.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          texts,
          model: cfg.model,
          input_type: "search_document",
        }),
      });
      if (!res.ok) {
        throw new Error(`embeddings: cohere request failed (${res.status})`);
      }
      const json = (await res.json()) as { embeddings?: number[][] };
      return json.embeddings ?? [];
    },
  };
}

/**
 * Thrown when an embeddings operation is attempted with no provider configured.
 * Names the missing var so the fix is obvious and never leaks a partial config
 * (mirrors AiNotConfiguredError).
 */
export class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super(
      "Embeddings are not configured: set EMBEDDINGS_PROVIDER (voyage|cohere) and " +
        "EMBEDDINGS_API_KEY to enable lib/ai/embeddings + RAG (see .env.example / ADR-043). " +
        "Guard optional RAG paths with isEmbeddingsConfigured().",
    );
    this.name = "EmbeddingsNotConfiguredError";
  }
}
