import { defineConfig, devices } from "@playwright/test";

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
