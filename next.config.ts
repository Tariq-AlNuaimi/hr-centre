import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const isDev = process.env.NODE_ENV !== "production";

// Conservative starting policy. Caveats documented in SECURITY.md finding T-05:
//   - 'unsafe-inline' on script-src is needed for Next.js bootstrap inline scripts;
//     removing it requires a nonce-based setup that Ant Design's SSR doesn't support out of the box.
//   - 'unsafe-inline' on style-src is needed for Ant Design's runtime CSS-in-JS.
//   - 'unsafe-eval' on script-src is needed in dev for React Refresh / HMR; production drops it.
//   - img-src allows local MinIO endpoints used in dev; tighten to your prod MinIO host per project.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http://localhost:9000 http://minio:9000",
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
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
      },
      {
        protocol: "http",
        hostname: "minio",
        port: "9000",
      },
    ],
  },
};

// Sentry webpack/turbopack plugin wrapping. Source-map upload is gated on
// SENTRY_AUTH_TOKEN being present so local builds (and forks that haven't
// configured Sentry yet) work without the token. CI provides the token via
// the SENTRY_AUTH_TOKEN repo secret -- see docker-build.yml and ADR-002.
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);
const isCI = process.env.CI === "true" || process.env.CI === "1";

const baseConfig = withNextIntl(nextConfig);

export default withSentryConfig(baseConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silence Sentry CLI output unless the operator opts in (verbose=1) or we're
  // in a local build without the auth token (so the operator sees the skip).
  silent: isCI,
  // Don't run the SDK at all if the auth token is missing -- avoids the
  // webpack plugin trying to upload sourcemaps and failing local builds.
  widenClientFileUpload: true,
  // When `disable: true`, the plugin skips any source-map upload entirely.
  // We toggle on auth token so local + first-fork builds work without it.
  // (hideSourceMaps was removed in @sentry/nextjs 9.x; map visibility is now
  // handled by the build's static export defaults + `sourcemaps.disable`.)
  sourcemaps: {
    disable: !hasSentryAuth,
  },
  // Webpack-only options (Next 16 uses Turbopack by default; these no-op there).
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
