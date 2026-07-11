// lib/observability/index.ts — thin, typed helpers over the OpenTelemetry API
// (ADR-040). The SDK/provider is registered in instrumentation.ts; this module
// is the app-facing surface for creating spans.
//
// Everything here is SAFE WHEN OTEL IS OFF: `@opentelemetry/api` returns a no-op
// tracer when no provider is registered, so `withSpan` runs the callback with
// effectively zero overhead and never throws. Callers therefore never have to
// branch on whether observability is configured — they wrap the work and the
// backbone decides at runtime whether anything is exported (AC-5.1).

import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

import { isOtelEnabled, otelServiceName } from "./config";

export { isOtelEnabled, otelServiceName };

/** Instrumentation-scope name for spans this app creates directly. */
const TRACER_NAME = "app";

/**
 * Run `fn` inside a span named `name`. On success the span ends `OK`; if `fn`
 * throws, the error is recorded, the span is marked `ERROR`, and the error is
 * re-thrown unchanged — instrumentation never swallows failures. Works for sync
 * and async `fn` (a returned promise is awaited before the span closes).
 *
 * When OTel is not configured the tracer is a no-op, so this adds a closure call
 * and nothing else. Use it to trace a service call or an expensive operation:
 *
 *   const rows = await withSpan("users.list", () => userService.list(args));
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
