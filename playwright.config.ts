import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Chromium binary resolution (ADR / issue #52).
//
// In a Claude Code web session the env ships a pre-installed Chromium under
// /opt/pw-browsers, but its revision can lag the one the installed @playwright
// version expects (e.g. PW 1.61 wants rev 1228; the env ships 1194), so the
// bundled-binary launch fails with "Executable doesn't exist". We let the
// caller point Playwright at a known-good binary instead of re-downloading:
//   1. PW_EXECUTABLE_PATH (explicit override) always wins.
//   2. Otherwise auto-detect a chromium build under PLAYWRIGHT_BROWSERS_PATH
//      (defaults to /opt/pw-browsers). This directory does NOT exist on a normal
//      dev machine, so auto-detect is a no-op off-platform and the bundled
//      binary is used exactly as before — making this purely additive.
function resolveChromiumPath(): string | undefined {
  if (process.env.PW_EXECUTABLE_PATH) {
    const p = process.env.PW_EXECUTABLE_PATH;
    if (existsSync(p)) return p;
    console.warn(
      `[playwright] PW_EXECUTABLE_PATH=${p} does not exist; falling back to auto-detect / bundled Chromium.`,
    );
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    // Prefer the highest revision present (readdir is unordered, so sort desc).
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith("chromium"))
      .sort()
      .reverse();
    for (const d of dirs) {
      const candidate = path.join(root, d, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // root missing / unreadable -> fall through to the bundled binary.
  }
  return undefined;
}

const chromiumPath = resolveChromiumPath();

// Optional egress proxy for the browser (issue #52, part 2).
//
// Some environments (e.g. a Claude Code web session) only allow outbound traffic
// through an HTTPS egress proxy, so Chromium can't reach a deployed UAT target
// directly. Set PW_PROXY_SERVER (e.g. the session's $HTTPS_PROXY) to route the
// browser through it. This is OFF by default, so normal dev/CI is unchanged.
// A TLS-intercepting proxy re-signs certs, so when a proxy IS configured we also
// accept its MITM cert (ignoreHTTPSErrors) — scoped to the proxy case only, never
// relaxed for ordinary runs. NOTE: whether the proxy is actually browser-traversable
// is an environment property, not something this config can guarantee.
const proxyServer = process.env.PW_PROXY_SERVER;

// UAT (User Acceptance Testing) config — browser-driven walkthrough of the app.
//
// Two modes (selected by env flag UAT_MODE; default "lean"):
//   - lean (default) — fast smoke + guard specs. The everyday "click through it" tool.
//   - full           — additionally runs the deep-audit `*.full.uat.ts` specs and
//                       records video for every test (lean only keeps video on failure).
//     Set via `npm run uat` (lean) / `npm run uat:full` (full).
//
// Target resolution (decision: URL-first, local fallback):
//   - UAT_BASE_URL set        -> run against that URL (your Vercel preview / prod).
//   - UAT_BASE_URL unset       -> http://localhost:3000, and auto-start `npm run dev`.
//
// Per-machine setup once: `npm run uat:install` (downloads the Chromium binary).
// Credentials come from env (UAT_EMAIL/UAT_PASSWORD or SEED_ADMIN_*); never hardcoded.

const baseURL = process.env.UAT_BASE_URL ?? "http://localhost:3000";
const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
const isFull = process.env.UAT_MODE === "full";

export default defineConfig({
  testDir: "./tests/uat",
  outputDir: "./uat-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "uat-report", open: "never" }],
    // JSON results feed the PDF assembler (`npm run uat:pdf` -> scripts/uat-pdf.mjs).
    ["json", { outputFile: "uat-results/results.json" }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    screenshot: "on",
    trace: "on-first-retry",
    // Full mode records every flow (deep audit / PDF); lean keeps video only on failure.
    video: isFull ? "on" : "retain-on-failure",
    // Point Chromium at an explicit / auto-detected binary when one is resolved
    // (web-session envs); undefined elsewhere -> Playwright uses its bundled one.
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
    // Route the browser through an egress proxy when one is configured (issue #52).
    proxy: proxyServer ? { server: proxyServer } : undefined,
    // Accept the proxy's TLS-MITM cert ONLY when proxying; never relaxed otherwise.
    ignoreHTTPSErrors: proxyServer ? true : undefined,
  },
  projects: [
    // Logs in once as ADMIN and saves the session so flows don't re-authenticate.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // P2 (full only): provision + log in EACH non-admin role and save its storage
    // state, so the permission-matrix spec can drive the app as that role. Depends
    // on `setup` because it reuses admin.json for the ADMIN column. Registered ONLY
    // in full mode — lean never runs roles.setup or the matrix.
    ...(isFull
      ? [
          {
            name: "roles-setup",
            testMatch: /roles\.setup\.ts/,
            dependencies: ["setup"],
          },
        ]
      : []),
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "uat-results/.auth/admin.json",
      },
      // Lean depends on the admin setup only. Full additionally depends on the
      // per-role setup so every role's storage state exists before the matrix runs.
      dependencies: isFull ? ["setup", "roles-setup"] : ["setup"],
      // Spec selection by mode:
      //   - Both modes run the smoke + guard specs (`*.uat.ts`).
      //   - Only full mode runs the deep-audit specs (`*.full.uat.ts`) — incl. the
      //     P2 permission matrix (roles.full.uat.ts).
      // Lean ignores `*.full.uat.ts` so Full-only phases never run in lean. We also
      // ignore the *.setup.ts files here so they don't double-run as chromium specs.
      testMatch: /\.uat\.ts$/,
      testIgnore: isFull ? undefined : /\.full\.uat\.ts$/,
    },
  ],
  // Only auto-start the dev server when targeting localhost. Requires a running
  // database + a seeded admin user (see tests/uat/README.md).
  webServer: isLocal
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
