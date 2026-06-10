// Vibe Inspector — resolve the browser engine (Browserbase) config (ADR-016).
//
// Precedence: the singleton BrowserEngineConfig row (set via Settings, key
// decrypted) → env fallback (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID). Throws
// a clear, actionable error when nothing is configured — the engine turns that into
// a FAILED run (never a false green).

import { prisma } from "@/lib/prisma";
import { tryDecryptSecret } from "@/lib/secret-box";

export const BROWSER_CONFIG_ID = "singleton";

export interface ResolvedBrowserConfig {
  apiKey: string;
  projectId: string;
  source: "db" | "env";
}

export async function getStoredBrowserConfig() {
  return prisma.browserEngineConfig.findUnique({ where: { id: BROWSER_CONFIG_ID } });
}

export async function resolveBrowserConfig(): Promise<ResolvedBrowserConfig> {
  const row = await getStoredBrowserConfig();
  if (row) {
    const apiKey = tryDecryptSecret(row.apiKeyEnc) ?? "";
    if (apiKey && row.projectId) {
      return { apiKey, projectId: row.projectId, source: "db" };
    }
  }

  const envKey = process.env.BROWSERBASE_API_KEY;
  const envProject = process.env.BROWSERBASE_PROJECT_ID;
  if (envKey && envProject) {
    return { apiKey: envKey, projectId: envProject, source: "env" };
  }

  throw new Error(
    "Browser engine not configured. Set the Browserbase API key + project id in " +
      "Settings → Browser engine (or the BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID env vars)."
  );
}
