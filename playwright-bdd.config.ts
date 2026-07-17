import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// BDD (Gherkin) config — ADR-058 / V2-207. Kept SEPARATE from playwright.config.ts (the UAT
// runner) so adopting playwright-bdd doesn't disturb the existing `npm run uat` flow.
//
// `bddgen` (npm run bdd:gen) generates Playwright specs from tests/features/*.feature +
// tests/features/steps/*.ts into `.features-gen/` (gitignored); `playwright test --config
// playwright-bdd.config.ts` runs them. Story→scenario→step COVERAGE is machine-verified now by
// `npm run bdd-coverage` (dependency-free); actual scenario EXECUTION needs a running app + DB
// (a UAT_BASE_URL target or `npm run dev` + a seeded DB) — the enforced `/ship --full` wiring is
// V2-401 (Phase 4). See ADR-058.

const testDir = defineBddConfig({
  features: "tests/features/**/*.feature",
  steps: "tests/features/steps/**/*.ts",
});

// Reuse the env-Chromium resolution from playwright.config.ts's rationale (issue #52): a
// web-session ships a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH; off-platform this is a no-op.
function resolveChromiumPath(): string | undefined {
  if (process.env.PW_EXECUTABLE_PATH && existsSync(process.env.PW_EXECUTABLE_PATH))
    return process.env.PW_EXECUTABLE_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const rev = (d: string): number => Number(d.slice("chromium-".length)) || 0;
    for (const d of readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => rev(a) - rev(b))
      .reverse()) {
      const candidate = path.join(root, d, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* fall through to bundled */
  }
  return undefined;
}

const baseURL = process.env.UAT_BASE_URL ?? "http://localhost:3000";
const chromiumPath = resolveChromiumPath();

export default defineConfig({
  testDir,
  outputDir: "./bdd-results",
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
  },
});
