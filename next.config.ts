import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// `npm run analyze` (ANALYZE=true) emits an interactive bundle treemap so a fork
// can see what ships to the client before optimizing. No-op on normal builds.
const withAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const isDev = process.env.NODE_ENV !== "production";

// Conservative starting policy. Caveats documented in SECURITY.md finding T-05:
//   - 'unsafe-inline' on script-src is needed for Next.js bootstrap inline
//     scripts. Removing it requires a nonce-based setup that Ant Design's SSR
//     doesn't support out of the box.
//   - 'unsafe-inline' on style-src is needed for Ant Design's runtime CSS-in-JS.
//   - 'unsafe-eval' on script-src is needed in dev for React Refresh / HMR.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // playwright-core (Vibe Inspector's browser driver, ADR-016) must be loaded from
  // node_modules at runtime, not bundled into the serverless function — bundling
  // breaks its dynamic file requires and makes the route module fail to load (500).
  serverExternalPackages: ["playwright-core"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // API-versioning seam (ADR-013): external/machine consumers hit the stable
  // `/api/v1/*` path, which rewrites to the current `/api/*` handlers -- zero
  // route churn today, and a real v2 can diverge later without breaking v1.
  // Internal app code keeps calling `/api/*` directly.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "/api/:path*" }];
  },
};

// Sentry plugin wrapping. Source-map upload is gated on SENTRY_AUTH_TOKEN
// being present so local builds (and forks that haven't configured Sentry
// yet) work without the token. Set SENTRY_AUTH_TOKEN as a Vercel env var
// to enable source-map upload from CI.
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);
const isCI = process.env.CI === "true" || process.env.CI === "1";

const baseConfig = withAnalyzer(withNextIntl(nextConfig));

export default withSentryConfig(baseConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: isCI,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !hasSentryAuth,
  },
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
