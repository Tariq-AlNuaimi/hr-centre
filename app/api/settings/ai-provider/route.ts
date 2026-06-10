import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { encryptSecret, tryDecryptSecret, maskSecret } from "@/lib/secret-box";
import { updateAiProviderSchema } from "@/lib/validations/ai-provider";
import {
  AI_CONFIG_ID,
  DEFAULT_ANTHROPIC_MODEL,
  PROVIDER_PRESETS,
  getStoredConfig,
} from "@/lib/testing/ai-config";

// Shape the client sees — NEVER the raw key, only a masked indicator.
function summarize(args: {
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE";
  baseUrl: string | null;
  model: string;
  apiKeyMasked: string | null;
  source: "db" | "env";
}) {
  return {
    provider: args.provider,
    baseUrl: args.baseUrl,
    model: args.model,
    hasApiKey: args.apiKeyMasked !== null,
    apiKeyMasked: args.apiKeyMasked,
    source: args.source,
    presets: PROVIDER_PRESETS,
  };
}

// Read the current AI provider settings (admin-only).
export const GET = withAdminAuth(async () => {
  const row = await getStoredConfig();
  const envKey = process.env.ANTHROPIC_API_KEY;

  if (row) {
    const stored = tryDecryptSecret(row.apiKeyEnc); // null if AUTH_SECRET rotated/corrupt
    let masked: string | null = null;
    if (stored) masked = maskSecret(stored);
    else if (row.provider === "ANTHROPIC" && envKey) masked = maskSecret(envKey);
    return ok(
      summarize({
        provider: row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        apiKeyMasked: masked,
        source: "db",
      })
    );
  }

  // No row yet — reflect the env fallback (Anthropic).
  return ok(
    summarize({
      provider: "ANTHROPIC",
      baseUrl: null,
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      apiKeyMasked: envKey ? maskSecret(envKey) : null,
      source: "env",
    })
  );
});

// Save the AI provider settings (admin-only). A blank apiKey keeps the existing one.
export const PUT = withAdminAuth(async (request: NextRequest, { session }) => {
  const body = await request.json();
  const parsed = updateAiProviderSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const { provider, model } = parsed.data;
  const baseUrl = provider === "OPENAI_COMPATIBLE" ? (parsed.data.baseUrl?.trim() ?? null) : null;

  const existing = await getStoredConfig();
  const newKey = parsed.data.apiKey?.trim();
  // Encrypt a freshly-provided key; otherwise keep whatever was stored.
  const apiKeyEnc = newKey ? encryptSecret(newKey) : existing?.apiKeyEnc ?? null;

  const row = await prisma.aiProviderConfig.upsert({
    where: { id: AI_CONFIG_ID },
    create: { id: AI_CONFIG_ID, provider, baseUrl, model, apiKeyEnc, updatedBy: session.user.id },
    update: { provider, baseUrl, model, apiKeyEnc, updatedBy: session.user.id },
  });

  const envKey = process.env.ANTHROPIC_API_KEY;
  const stored = tryDecryptSecret(row.apiKeyEnc);
  let masked: string | null = null;
  if (stored) masked = maskSecret(stored);
  else if (row.provider === "ANTHROPIC" && envKey) masked = maskSecret(envKey);

  return ok(
    summarize({
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKeyMasked: masked,
      source: "db",
    })
  );
});
