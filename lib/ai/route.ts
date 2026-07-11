// lib/ai/route.ts — the shared AI-route combinator (ADR-036, WS-5 follow-on).
//
// Every scaffolded AI endpoint repeats the identical inner wiring: guard
// isAiConfigured() -> parse+validate the body with zod -> run the handler inside
// a withSpan(). withAiRoute factors that block out so the emitted route shrinks to
// the parts that actually vary (the prompt shape, the tools, the response), while
// the cross-cutting guard/parse/trace stays defined ONCE here instead of being
// re-derived (and occasionally skipped) per hand-written route.
//
// It deliberately does NOT add auth or rate-limiting: those stay explicit in the
// emitted route so the --writes wrapper is visible at the call site and
// withRateLimit stays OUTERMOST (no-rate-limit-inside-auth rule; the model call is
// the expensive downstream). Compose them AROUND the handler this returns:
//
//   export const POST = withRateLimit(
//     withEditorAuth(withAiRoute({ span: "ai.foo", schema: fooSchema }, async (input, request) => {
//       const final = await runAgent({ messages: [{ role: "user", content: input.prompt }], tools: [] });
//       return ok({ text: extractText(final) });
//     })),
//     { id: "ai-foo", limit: 20, windowMs: 60_000 },
//   );

import type { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";

import { err } from "@/lib/api-response";
import { withSpan } from "@/lib/observability";
import { isAiConfigured } from "@/lib/ai/config";

/** Options for {@link withAiRoute}. */
export interface WithAiRouteOptions<T> {
  /** Span name for the traced handler (e.g. "ai.summarize"). */
  span: string;
  /** Zod schema the request body must satisfy; its output type flows to `run`. */
  schema: ZodType<T>;
}

/**
 * Wrap an AI request handler with the standard guard/parse/trace preamble and
 * return a `(request) => Promise<NextResponse>` ready to compose under the auth +
 * rate-limit wrappers. In order:
 *   1. isAiConfigured() gate -> 503 err() when the AI layer is unconfigured;
 *   2. body parse (`await request.json().catch(() => null)`) + `opts.schema.safeParse`
 *      -> 400 err() with the joined zod issue messages on failure;
 *   3. `run(parsedData, request)` executed inside `withSpan(opts.span, ...)`.
 * Auth and rate-limiting are intentionally left to the caller (see the module note).
 */
export function withAiRoute<T>(
  opts: WithAiRouteOptions<T>,
  run: (input: T, request: NextRequest) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    // Honest failure: the AI layer is opt-in (silent no-op until AI_API_KEY is set).
    if (!isAiConfigured()) {
      return err("AI is not configured on this deployment", 503);
    }

    const body = await request.json().catch(() => null);
    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    return withSpan(opts.span, () => run(parsed.data, request));
  };
}
