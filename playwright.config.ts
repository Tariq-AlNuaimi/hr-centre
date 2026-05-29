import { defineConfig, devices } from "@playwright/test";

// UAT (User Acceptance Testing) config — browser-driven walkthrough of the app.
//
// Target resolution (decision: URL-first, local fallback):
//   - UAT_BASE_URL set        -> run against that URL (your Vercel preview / prod).
//   - UAT_BASE_URL unset       -> http://localhost:3000, and auto-start `npm run dev`.
//
// Per-machine setup once: `npm run uat:install` (downloads the Chromium binary).
// Credentials come from env (UAT_EMAIL/UAT_PASSWORD or SEED_ADMIN_*); never hardcoded.

const baseURL = process.env.UAT_BASE_URL ?? "http://localhost:3000";
const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");

export default defineConfig({
  testDir: "./tests/uat",
  outputDir: "./uat-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "uat-report", open: "never" }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    screenshot: "on",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    // Logs in once and saves the session so flows don't re-authenticate each time.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "uat-results/.auth/admin.json",
      },
      dependencies: ["setup"],
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
