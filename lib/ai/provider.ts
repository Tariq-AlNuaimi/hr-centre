// lib/ai/provider.ts — the endpoint-agnostic Claude client factory (ADR-036).
//
// One configured @anthropic-ai/sdk client for the whole app, built from the
// deploy-time config in ./config. The code stays Anthropic-wire-native (ADR-036)
// while the ENDPOINT is pure config (operator decision, session 15): AI_BASE_URL
// points the SDK at Anthropic's hosted API (unset) or a self-hosted /
// Anthropic-compat gateway (set), and AI_AUTH_STYLE picks the auth header —
// AI_API_KEY rides `apiKey` (sent as x-api-key) or `authToken` (Authorization:
// Bearer). Switching endpoints is therefore a deploy-time change, never a diff.

import Anthropic from "@anthropic-ai/sdk";

import { aiConfig, isAiConfigured } from "./config";

export { isAiConfigured };
export { AiNotConfiguredError } from "./config";
export type { AiAuthStyle, AiConfig } from "./config";

/**
 * A configured Anthropic client, or throws {@link AiNotConfiguredError} when no
 * AI_API_KEY is set — never returns a half-initialized client that would 401 at
 * call time (AC-1.2). `baseURL` and the auth header come from env, so the same
 * build targets Anthropic-hosted or a self-hosted endpoint by config (AC-3.1):
 *
 *   const client = getAiClient();
 *   const msg = await client.messages.create({ model, max_tokens, messages });
 *
 * The client is cheap to construct and holds no persistent connection, so this
 * builds a fresh one per call — deliberately, so a mid-process env change (tests,
 * hot config) is honored rather than cached behind a module-level singleton.
 */
export function getAiClient(): Anthropic {
  const { apiKey, baseUrl, authStyle } = aiConfig();
  // Anthropic-wire-native: x-api-key rides `apiKey`, Bearer rides `authToken`.
  // Pin BOTH fields explicitly (the unused one to null) so the auth style is
  // deterministic: the SDK otherwise defaults an unset field from ambient env
  // (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN), which in bearer mode would send
  // x-api-key AND Authorization: Bearer together — a dual-auth 401 the API
  // rejects, from a var outside our AI_* contract. Passing null suppresses that.
  return new Anthropic({
    apiKey: authStyle === "bearer" ? null : apiKey,
    authToken: authStyle === "bearer" ? apiKey : null,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
}
