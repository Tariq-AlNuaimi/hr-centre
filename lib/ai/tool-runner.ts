// lib/ai/tool-runner.ts — a thin wrapper over the native Anthropic Tool Runner
// (ADR-036). The Tool Runner (`client.beta.messages.toolRunner`) drives the
// agentic request -> execute -> loop cycle for tools you define, so we get the
// Claude-native agent loop WITHOUT hand-rolling it or importing a framework
// (Mastra/LangGraph are deferred; the Vercel AI SDK is reserved for the UI
// streaming seam and is not pulled in here).
//
// The wrapper is deliberately a pass-through: it injects the default model
// (AI_MODEL, ADR-022 routing) and a default max_tokens ONLY when the caller
// omits them, then returns the native runner UNCHANGED — so no Tool-Runner
// capability is hidden behind the seam. The returned runner is awaitable for the
// final message and async-iterable for per-turn hooks (approval gates, result
// modification, retries — see the @anthropic-ai/sdk tool-runner docs).

import type Anthropic from "@anthropic-ai/sdk";

import { aiConfig } from "./config";
import { getAiClient } from "./provider";

/** Default per-turn output cap when a caller omits max_tokens (non-streaming default). */
export const AI_DEFAULT_MAX_TOKENS = 16000;

// Typed off the SDK method itself (not a restated shape) so the wrapper tracks
// the beta Tool-Runner API across SDK versions without drifting.
type ToolRunnerParams = Parameters<
  Anthropic["beta"]["messages"]["toolRunner"]
>[0];
type ToolRunnerReturn = ReturnType<Anthropic["beta"]["messages"]["toolRunner"]>;

/** runAgent params: everything the native Tool Runner takes, but model + max_tokens are optional (defaulted). */
export type RunAgentParams = Omit<ToolRunnerParams, "model" | "max_tokens"> &
  Partial<Pick<ToolRunnerParams, "model" | "max_tokens">>;

/**
 * Run the native Anthropic Tool Runner with the app's configured client and
 * defaults. Throws {@link AiNotConfiguredError} BEFORE any network attempt when
 * the AI layer is unconfigured (AC-2.2). Returns the native runner unchanged:
 *
 *   const finalMessage = await runAgent({ messages, tools });   // await for the result
 *   for await (const message of runAgent({ messages, tools })) { ... }  // or iterate per-turn
 *
 * A caller-supplied `model` / `max_tokens` always wins over the defaults, and
 * every other Tool-Runner option (system, tool_choice, max_iterations, stream,
 * per-turn hooks) passes straight through.
 */
export function runAgent(params: RunAgentParams): ToolRunnerReturn {
  // aiConfig() throws when unconfigured — this is the pre-network guard (AC-2.2).
  const { model } = aiConfig();
  const client = getAiClient();
  const merged = {
    ...params,
    model: params.model ?? model,
    max_tokens: params.max_tokens ?? AI_DEFAULT_MAX_TOKENS,
  } as ToolRunnerParams;
  return client.beta.messages.toolRunner(merged);
}
