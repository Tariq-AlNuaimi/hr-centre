import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { encryptSecret, tryDecryptSecret, maskSecret } from "@/lib/secret-box";
import { updateBrowserEngineSchema } from "@/lib/validations/browser-engine";
import { BROWSER_CONFIG_ID, getStoredBrowserConfig } from "@/lib/testing/browser-config";

function summarize(args: {
  projectId: string | null;
  apiKeyMasked: string | null;
  source: "db" | "env";
}) {
  return {
    projectId: args.projectId,
    hasApiKey: args.apiKeyMasked !== null,
    apiKeyMasked: args.apiKeyMasked,
    source: args.source,
  };
}

// Read the current browser-engine (Browserbase) settings (admin-only).
export const GET = withAdminAuth(async () => {
  const row = await getStoredBrowserConfig();
  const envKey = process.env.BROWSERBASE_API_KEY;
  const envProject = process.env.BROWSERBASE_PROJECT_ID;

  if (row && (row.apiKeyEnc || row.projectId)) {
    const stored = tryDecryptSecret(row.apiKeyEnc);
    return ok(
      summarize({
        projectId: row.projectId,
        apiKeyMasked: stored ? maskSecret(stored) : null,
        source: "db",
      })
    );
  }

  return ok(
    summarize({
      projectId: envProject ?? null,
      apiKeyMasked: envKey ? maskSecret(envKey) : null,
      source: "env",
    })
  );
});

// Save the browser-engine settings (admin-only). A blank apiKey keeps the existing one.
export const PUT = withAdminAuth(async (request: NextRequest, { session }) => {
  const body = await request.json();
  const parsed = updateBrowserEngineSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const existing = await getStoredBrowserConfig();
  const newKey = parsed.data.apiKey?.trim();
  const apiKeyEnc = newKey ? encryptSecret(newKey) : existing?.apiKeyEnc ?? null;

  const row = await prisma.browserEngineConfig.upsert({
    where: { id: BROWSER_CONFIG_ID },
    create: { id: BROWSER_CONFIG_ID, projectId: parsed.data.projectId, apiKeyEnc, updatedBy: session.user.id },
    update: { projectId: parsed.data.projectId, apiKeyEnc, updatedBy: session.user.id },
  });

  const stored = tryDecryptSecret(row.apiKeyEnc);
  return ok(
    summarize({
      projectId: row.projectId,
      apiKeyMasked: stored ? maskSecret(stored) : null,
      source: "db",
    })
  );
});
