import { readFileSync } from "node:fs";
import { legacyRedirects } from "./lib/nav/legacy-redirects";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";

// React Compiler (ADR-048) is default-ON so every fork inherits auto-memoization,
// but the Babel transform adds ~35% to build time — a fleet-wide cost. A fork that
// doesn't want that pays nothing by setting `"reactCompiler": false` in
// project.config.json (the config-driven lever pattern used for locales/tier, and
// the opt-out precedent set by dockerAck/complexityAck). Read defensively at
// build-config eval: a missing key or unparseable file leaves it ON.
function reactCompilerEnabled(): boolean {
  try {
    const cfg = JSON.parse(readFileSync("project.config.json", "utf8"));
    return cfg.reactCompiler !== false;
  } catch {
    return true;
  }
}

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// `npm run analyze` (ANALYZE=true) or `ANALYZE=1 npm run build` (the /scale-up §15
// recipe form) emits an interactive bundle treemap so a fork can see what ships to
// the client before optimizing. Accepts either flag value; a no-op on normal/Vercel
// builds (env unset), so the default build behavior is byte-for-byte unchanged.
const analyzeFlag = process.env.ANALYZE;
const withAnalyzer = withBundleAnalyzer({
  enabled: analyzeFlag === "true" || analyzeFlag === "1",
});

// Docker is a STANDARD build artifact (ADR-030, supersedes ADR-023's opt-in
// stance) -- the image is gated at `/ship --full`, /deploy, /handoff, and CI. The
// gate MECHANISM here is unchanged: Vercel (ADR-006) stays the default deploy path,
// and `output: "standalone"` is emitted ONLY when DOCKER_BUILD is set, so the Vercel
// build is byte-for-byte unchanged and the self-host image stays small (it ships
// just the traced runtime under .next/standalone). `make docker-build` sets it.
const isDockerBuild = process.env.DOCKER_BUILD === "1" || process.env.DOCKER_BUILD === "true";

// NOTE (T-05 / recipe shared-security/3): Content-Security-Policy is intentionally
// NOT set here. A static next.config header can't carry a per-request nonce, so
// `middleware.ts` now builds the CSP — nonce-based on script-src (drops
// 'unsafe-inline'); style-src keeps 'unsafe-inline' for Ant Design 6 emotion until
// AntD 7. The Sentry connect-src origin is derived there too. The OTHER security
// headers below are static and stay here.
const securityHeaders = [
  // DENY (not SAMEORIGIN): the app is never framed by itself either, and this
  // matches the CSP `frame-ancestors 'none'` (now set in middleware.ts).
  // Belt-and-suspenders against clickjacking on the older header-based path.
  { key: "X-Frame-Options", value: "DENY" },
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
  // React Compiler (ADR-048) — stable in Next 16; auto-memoizes client components to
  // cut needless re-renders (client-runtime responsiveness, a High-Quality/UX-perf
  // concern) with zero hand-written useMemo/useCallback. Default-ON via the
  // project.config.json lever above; a fork opts out with `"reactCompiler": false`.
  // Uses the stable Babel transform (babel-plugin-react-compiler, a build-time
  // devDep). The faster native `experimental.turbopackRustReactCompiler` Rust port
  // is NOT in next@16.2.10's config type yet (canary-only) — revisit at the next
  // pinned-Next bump (ADR-048). The Babel pass adds ~35% to build time; the runtime
  // win is the trade. The compiler bails out safely on any component that violates
  // the Rules of React, so adoption is additive.
  reactCompiler: reactCompilerEnabled(),
  // ADR-088: inline the client DSN even when it is unset (as ""), so the lazy
  // Sentry import in instrumentation-client.ts is statically dead without one
  // and the SDK (~150 kB gzip) is never emitted into the client bundle.
  env: { NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "" },
  // Opt-in only -- see isDockerBuild above (ADR-023). `undefined` on Vercel.
  output: isDockerBuild ? "standalone" : undefined,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // API-versioning seam (ADR-013): external/machine consumers hit the stable
  // `/api/v1/*` path, which rewrites to the current `/api/*` handlers -- zero
  // route churn today, and a real v2 can diverge later without breaking v1.
  // Internal app code keeps calling `/api/*` directly.
  // UX P1 (docs/blueprints/ux-p1-nav.md AC-6.1): the ticket screens moved from
  // /hive/* to /tickets/*. Sent emails, notifications and bookmarks carry the
  // old URLs, so each old page redirects permanently. Pure data in
  // lib/nav/legacy-redirects.ts so a contract test can pin every mapping.
  async redirects() {
    return legacyRedirects();
  },
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
  // ADR-088: the route manifest (~70 kB gzip, every route's pattern) only serves
  // client-side transaction names; without a client DSN nothing would read it.
  routeManifestInjection: process.env.NEXT_PUBLIC_SENTRY_DSN ? undefined : false,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !hasSentryAuth,
  },
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
