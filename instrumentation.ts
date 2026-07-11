// instrumentation.ts — Next.js 16 server-side instrumentation entry point.
//
// Called by Next once per process at boot, separately for the `nodejs` and
// `edge` runtimes. Used here to (1) fail-fast validate env via lib/env.ts,
// (2) register the OpenTelemetry backbone (`@vercel/otel`) when an OTLP endpoint
// is configured, and (3) wire `@sentry/nextjs` for error tracking. DSN comes
// from the per-project SENTRY_DSN env; the OTLP endpoint from
// OTEL_EXPORTER_OTLP_ENDPOINT. If either is unset, that path is a no-op so local
// dev / CI without observability continues to work.
//
// See ADR-002 (Sentry) + ADR-040 (OpenTelemetry backbone + SigNoz).

import * as Sentry from "@sentry/nextjs";

import { isOtelEnabled, otelServiceName } from "./lib/observability/config";

export async function register() {
  // Validate required env once, at server boot, on the Node runtime. This is
  // the only import of lib/env.ts -- without it the zod schema is dead code and
  // a misconfigured DATABASE_URL / AUTH_SECRET surfaces as a late runtime crash
  // instead of a clear boot-time error. Edge runtime gets a subset of env, so
  // we don't parse there.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/env");
  }

  // OpenTelemetry backbone (ADR-040). Register the OTel SDK ONLY when an OTLP
  // endpoint is configured, so an unconfigured deploy pays ZERO overhead
  // (AC-5.1) -- no exporter, no background flush loop, no import cost.
  // registerOTel handles both the nodejs and edge runtimes and reads the OTLP
  // endpoint/protocol from the standard OTEL_EXPORTER_OTLP_* env vars; the
  // Collector it points at is the swappable-backend seam (SigNoz by default).
  if (isOtelEnabled()) {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName: otelServiceName() });
  }

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn,
      environment,
      tracesSampleRate: 0.1,
      // Disable Sentry's own SDK logger -- noisy in container logs and the
      // app's audit-extension scrubbing only covers our captureError wrapper.
      debug: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment,
      tracesSampleRate: 0.1,
      debug: false,
    });
  }
}

// Re-export the request-error capture hook so Next can call into Sentry
// for unhandled errors thrown inside server components / route handlers.
export const onRequestError = Sentry.captureRequestError;
