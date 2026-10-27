// instrumentation-client.ts — Next.js 16 client-side instrumentation entry point.
//
// Initializes Sentry in the browser. DSN comes from NEXT_PUBLIC_SENTRY_DSN
// (public-by-design: Sentry DSNs are intended to ship in client bundles --
// see ADR-002 and SECURITY.md §6 for the classification rationale).
//
// If the DSN is unset, init is a no-op so local dev / unconfigured forks
// continue to work without errors.

type SentryModule = typeof import("@sentry/nextjs");

// ADR-088: the SDK is ~150 kB gzip of client JS. It is imported ON DEMAND, and
// only when a DSN is configured at build time — with no DSN the branch is
// statically dead and the SDK never ships. Trade-off: with a DSN, errors in the
// first moments before the chunk loads are not captured.
let sentry: SentryModule | null = null;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    sentry = Sentry;
    Sentry.init({
      dsn,
      environment:
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      integrations: [Sentry.replayIntegration(), Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.0,
      // Safe ONLY because replayIntegration() defaults to maskAllText: true + blockAllMedia: true.
      // A fork MUST NOT set maskAllText: false — that would ship Confidential PII (emails/names)
      // to Sentry, contradicting SECURITY.md §1 / lib/sentry.ts.
      replaysOnErrorSampleRate: 1.0,
      debug: false,
    });
  });
}

// Capture navigation transitions (Next 15+ App Router hook) — once loaded.
export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
): void {
  sentry?.captureRouterTransitionStart(...args);
}
