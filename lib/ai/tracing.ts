// lib/ai/tracing.ts — GenAI-semantic-convention tracing for the AI runtime
// (ADR-044, WS-5), built ENTIRELY on the WS-4 OpenTelemetry backbone (ADR-040).
//
// There is NO new tracing dependency here. Langfuse — the trace/eval backend the
// enterprise pivot targets for LLM observability — ingests OTLP, so we get
// Langfuse (or any OTLP sink: SigNoz, a Collector, a managed APM) for free by
// emitting spans through lib/observability's `withSpan` and decorating them with
// the OpenTelemetry **GenAI semantic-convention** attributes. A fork points
// OTEL_EXPORTER_OTLP_ENDPOINT at Langfuse's OTLP endpoint and the same spans
// this file emits show up as LLM generations — a deploy-time config change, not
// an app-code diff (mirrors the swappable-backend seam of ADR-040).
//
// SAFE WHEN OTEL IS OFF: `withSpan` is a no-op when no OTLP endpoint is set
// (ADR-040 AC-5.1), so `withAiSpan` adds a closure call and nothing else — no
// branch on whether observability is configured.
//
// PII / Restricted boundary (SECURITY.md §1): this module records ONLY call
// METADATA — model, token counts, finish reason. It NEVER writes prompt or
// completion TEXT as a span attribute by default. Optional content capture is
// gated behind AI_TRACE_CONTENT (default OFF) for a trusted debugging session in
// a non-production sink; leaving it unset is the safe production posture.

import type { Span } from "@opentelemetry/api";

import { withSpan } from "../observability";

/**
 * OpenTelemetry GenAI semantic-convention attribute keys
 * (https://opentelemetry.io/docs/specs/semconv/gen-ai/). Langfuse and other
 * OTLP-native LLM backends key their generation views off exactly these names,
 * so emitting them is what turns a plain span into an LLM generation downstream.
 */
export const GEN_AI_ATTR = {
  system: "gen_ai.system",
  operationName: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  requestMaxTokens: "gen_ai.request.max_tokens",
  responseModel: "gen_ai.response.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
} as const;

/** GenAI `gen_ai.system` value for the Claude-native runtime (lib/ai). */
export const GEN_AI_SYSTEM_ANTHROPIC = "anthropic";

/**
 * Structural (not SDK-coupled) shape of the metadata `withAiSpan` reads off the
 * final message a `runAgent` run resolves to. Duck-typed so the tracer never
 * pins the beta Tool-Runner return type — any object carrying these fields
 * (an Anthropic `Message`, a compat-gateway response) traces correctly.
 */
export interface AiResultLike {
  model?: string | null;
  stop_reason?: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
}

/** Request-side metadata set on the span BEFORE the model call runs. */
export interface AiSpanOptions {
  /** `gen_ai.request.model` — the model requested (e.g. the resolved AI_MODEL). */
  model?: string;
  /** `gen_ai.operation.name` — the GenAI operation. Default `"chat"`. */
  operation?: string;
  /** `gen_ai.system` — the provider. Default `"anthropic"`. */
  system?: string;
  /** `gen_ai.request.max_tokens` — the per-turn output cap, when known. */
  maxTokens?: number;
  /**
   * Extra span attributes to set at start. METADATA ONLY — never prompt text.
   * (Content capture goes through {@link recordAiContent}, gated by env.)
   */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * True when optional prompt/completion CONTENT capture is explicitly enabled via
 * AI_TRACE_CONTENT (`1`/`true`). Default OFF: content is Restricted/PII
 * (SECURITY.md §1), so production traces carry metadata only. Turn it on only
 * for a trusted debugging session against a non-production, access-controlled
 * OTLP sink.
 */
export function aiTraceContentEnabled(): boolean {
  const v = process.env.AI_TRACE_CONTENT;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Set the request-side GenAI attributes (called by `withAiSpan` before `fn`). */
export function setAiRequestAttributes(span: Span, opts: AiSpanOptions): void {
  span.setAttribute(GEN_AI_ATTR.system, opts.system ?? GEN_AI_SYSTEM_ANTHROPIC);
  span.setAttribute(GEN_AI_ATTR.operationName, opts.operation ?? "chat");
  if (opts.model) span.setAttribute(GEN_AI_ATTR.requestModel, opts.model);
  if (typeof opts.maxTokens === "number") {
    span.setAttribute(GEN_AI_ATTR.requestMaxTokens, opts.maxTokens);
  }
  if (opts.attributes) {
    for (const [k, val] of Object.entries(opts.attributes)) {
      span.setAttribute(k, val);
    }
  }
}

/**
 * Read the response-side GenAI metadata off `result` (the final message) and set
 * it on `span`. METADATA ONLY — model, token counts, finish reason — never the
 * message content. Tolerant of partial/absent fields (streaming, a compat
 * gateway that omits usage): each attribute is set only when present.
 */
export function setAiResponseAttributes(span: Span, result: unknown): void {
  const r = result as AiResultLike | null | undefined;
  if (!r || typeof r !== "object") return;
  if (typeof r.model === "string" && r.model.length > 0) {
    span.setAttribute(GEN_AI_ATTR.responseModel, r.model);
  }
  if (typeof r.stop_reason === "string" && r.stop_reason.length > 0) {
    // GenAI semconv models finish reasons as a string[] (parallel to n>1 candidates).
    span.setAttribute(GEN_AI_ATTR.responseFinishReasons, [r.stop_reason]);
  }
  const input = r.usage?.input_tokens;
  const output = r.usage?.output_tokens;
  if (typeof input === "number") {
    span.setAttribute(GEN_AI_ATTR.usageInputTokens, input);
  }
  if (typeof output === "number") {
    span.setAttribute(GEN_AI_ATTR.usageOutputTokens, output);
  }
}

/**
 * Optional prompt/completion CONTENT capture — a NO-OP unless AI_TRACE_CONTENT is
 * enabled (default OFF). Content is Restricted/PII (SECURITY.md §1); this exists
 * for a trusted debug session against a private sink, never for production. Even
 * when enabled it sets metadata-namespaced attributes, so a fork can still drop
 * them at the Collector. Pass already-serialized strings; nothing is logged.
 */
export function recordAiContent(
  span: Span,
  content: { prompt?: string; completion?: string },
): void {
  if (!aiTraceContentEnabled()) return;
  if (typeof content.prompt === "string") {
    span.setAttribute("gen_ai.prompt", content.prompt);
  }
  if (typeof content.completion === "string") {
    span.setAttribute("gen_ai.completion", content.completion);
  }
}

/**
 * Run `fn` (a model call — typically `await runAgent(...)`) inside an OTel span
 * decorated with GenAI-semconv attributes. Sets the request attributes from
 * `opts` before `fn`, then reads token usage + finish reason off whatever `fn`
 * resolves to and sets the response attributes. Error handling and span
 * lifecycle come from `withSpan` (records the exception, marks ERROR, re-throws).
 *
 *   const message = await withAiSpan(
 *     "ai.summarize",
 *     { model: aiConfig().model, maxTokens: AI_DEFAULT_MAX_TOKENS },
 *     () => runAgent({ messages, tools }),
 *   );
 *
 * No-op-safe when OTel is off (`withSpan` is), and records METADATA ONLY — never
 * prompt/completion text (that is opt-in via {@link recordAiContent}).
 */
export async function withAiSpan<T>(
  name: string,
  opts: AiSpanOptions,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  return withSpan(name, async (span) => {
    setAiRequestAttributes(span, opts);
    const result = await fn(span);
    setAiResponseAttributes(span, result);
    return result;
  });
}
