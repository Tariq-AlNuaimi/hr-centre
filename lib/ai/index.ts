// lib/ai/index.ts — the app-facing surface of the Claude-native AI runtime
// (ADR-036, WS-5). Import from "@/lib/ai", not the sub-modules.
//
// Skeleton scope this phase (operator decision, session 15): an endpoint-agnostic
// provider factory + a thin native Tool-Runner wrapper, both a silent no-op until
// AI_API_KEY is set. Deferred to follow-on WS-5 increments: /scaffold-ai-endpoint,
// the ai-eval /ship gate + AI-Quality pillar, pgvector RAG + embeddings, and an
// OpenAI-compatible provider path. Contract: ADR-036 (agent stack) + ADR-043
// (pgvector RAG) + ADR-044 (GenAI tracing); AI-Quality pillar in
// .claude/rules/ai.md. (The old pointer here named a blueprint that was never
// committed -- corrected 2026-07-25.)

export { isAiConfigured, aiConfig, AiNotConfiguredError } from "./config";
export type { AiAuthStyle, AiConfig } from "./config";
export { getAiClient } from "./provider";
export { runAgent, AI_DEFAULT_MAX_TOKENS } from "./tool-runner";
export type { RunAgentParams } from "./tool-runner";

// Shared AI-route combinator (guard/parse/trace preamble; ADR-036 follow-on).
export { withAiRoute } from "./route";
export type { WithAiRouteOptions } from "./route";

// Embeddings + pgvector RAG seam (ADR-043, WS-5).
export { getEmbeddings, isEmbeddingsConfigured, EmbeddingsNotConfiguredError } from "./embeddings";
export type { EmbeddingsProvider, EmbeddingsProviderName } from "./embeddings";
export { ragUpsert, ragQuery } from "./rag";
export type { RagHit, RagMetadata } from "./rag";

// GenAI-semconv tracing over the OTel backbone (ADR-044, WS-5).
export {
  withAiSpan,
  aiTraceContentEnabled,
  recordAiContent,
  setAiRequestAttributes,
  setAiResponseAttributes,
  GEN_AI_ATTR,
  GEN_AI_SYSTEM_ANTHROPIC,
} from "./tracing";
export type { AiSpanOptions, AiResultLike } from "./tracing";
