// lib/ai/config.ts — the Claude-native AI runtime gate + typed config (ADR-036).
//
// The AI layer (lib/ai/*) is a silent no-op unless AI_API_KEY is set: with no
// key, isAiConfigured() is false and getAiClient() throws an actionable error
// rather than constructing a client that would 401 at call time. This mirrors
// how observability (ADR-040) and email (lib/email.ts {sent:false}) degrade
// when unconfigured — callers get an honest failure, not a half-initialized one.
//
// Like lib/observability/config.ts, this reads process.env DIRECTLY (not the
// zod-parsed lib/env) so the gate evaluates at CALL time — one definition of
// "is AI on and how", and no coupling to lib/env's import-time parse. The AI_*
// vars are still declared in lib/env.ts for the env contract + boot-time
// validation (a bad AI_BASE_URL fails loud there); this module is the runtime
// source of truth. Endpoint-agnostic by operator decision (session 15):
// AI_BASE_URL / AI_API_KEY / AI_AUTH_STYLE make the endpoint pure deploy-time
// config, so the same build targets Anthropic's hosted API or a self-hosted /
// Anthropic-compat endpoint.

/** How AI_API_KEY is sent to the endpoint. */
export type AiAuthStyle = "x-api-key" | "bearer";

/**
 * Default model/tier when AI_MODEL is unset. There is no automatic
 * product-facing routing policy this phase — a per-call `model` override passes
 * straight through runAgent(); a later WS-5 increment may add real routing.
 */
const DEFAULT_MODEL = "claude-opus-4-8";

/** Resolved, endpoint-agnostic AI provider config (only valid when configured). */
export interface AiConfig {
  /** The API key. Restricted — never logged. */
  apiKey: string;
  /** Endpoint base URL; undefined => the SDK's Anthropic default. */
  baseUrl: string | undefined;
  /** Which auth header carries the key. */
  authStyle: AiAuthStyle;
  /** Default model/tier; per-call override passes through runAgent (no auto routing this phase). */
  model: string;
}

/**
 * True when the AI layer has the one thing it cannot default: an API key. This
 * is the ONLY gate that decides whether the provider will construct — keep every
 * consumer routed through here so the "no key => no client" invariant (AC-1.2)
 * has one definition.
 */
export function isAiConfigured(): boolean {
  const key = process.env.AI_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * The resolved config. Throws {@link AiNotConfiguredError} when unconfigured —
 * call {@link isAiConfigured} first if you need to branch without throwing. The
 * baseUrl / authStyle / model all come from env, so switching endpoints is a
 * deploy-time change, never an app-code diff.
 */
export function aiConfig(): AiConfig {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new AiNotConfiguredError();
  }
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const model = process.env.AI_MODEL?.trim();
  return {
    apiKey,
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : undefined,
    // lib/env.ts is the authoritative boot-time validator (a value other than
    // x-api-key/bearer fails app startup loud); this coerce is the defensive
    // default for non-boot contexts (scripts/tests) that skip that parse.
    authStyle: process.env.AI_AUTH_STYLE === "bearer" ? "bearer" : "x-api-key",
    model: model && model.length > 0 ? model : DEFAULT_MODEL,
  };
}

/**
 * Thrown when an AI operation is attempted with no AI_API_KEY configured. Names
 * the missing var so the fix is obvious and never leaks a partial config.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "AI runtime is not configured: set AI_API_KEY to enable lib/ai (see .env.example / ADR-036). " +
        "Guard optional AI paths with isAiConfigured().",
    );
    this.name = "AiNotConfiguredError";
  }
}
