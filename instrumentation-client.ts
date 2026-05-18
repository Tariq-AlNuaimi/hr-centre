// instrumentation-client.ts — Next.js 16 client-side instrumentation entry point.
//
// Initializes Sentry in the browser. DSN comes from NEXT_PUBLIC_SENTRY_DSN
// (public-by-design: Sentry DSNs are intended to ship in client bundles --
// see ADR-002 and SECURITY.md §6 for the classification rationale).
//
// If the DSN is unset, init is a no-op so local dev / unconfigured forks
// continue to work without errors.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    integrations: [
      Sentry.replayIntegration(),
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    debug: false,
  });
}

// Capture navigation transitions (Next 15+ App Router hook).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
