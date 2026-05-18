// instrumentation.ts — Next.js 16 server-side instrumentation entry point.
//
// Called by Next once per process at boot, separately for the `nodejs` and
// `edge` runtimes. Used here to wire `@sentry/nextjs` for error tracking +
// auto-instrumentation. DSN comes from the per-project SENTRY_DSN env (see
// lib/env.ts + ADR-002). If unset, Sentry init is a no-op so local dev / CI
// without Sentry continues to work.
//
// See ADR-002 (observability stack).

import * as Sentry from "@sentry/nextjs";

export async function register() {
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
