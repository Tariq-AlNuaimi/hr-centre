import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { resolveAiConfig, getStoredConfig } from "@/lib/testing/ai-config";
import { tryDecryptSecret, redactSecret } from "@/lib/secret-box";
import { updateAiProviderSchema } from "@/lib/validations/ai-provider";

export const maxDuration = 30;

interface TestConfig {
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE";
  baseUrl: string | null;
  model: string;
  apiKey: string;
}

// Resolve what to test: prefer the values posted from the form (so the operator can
// test a freshly-typed key BEFORE saving), falling back to the stored/env config.
async function effectiveConfig(request: NextRequest): Promise<TestConfig> {
  const body = await request.json().catch(() => null);
  const parsed = updateAiProviderSchema.safeParse(body);

  if (parsed.success) {
    let apiKey = parsed.data.apiKey?.trim() ?? "";
    if (!apiKey) {
      // Field left blank → reuse the stored key (or the env key for Anthropic).
      const stored = await getStoredConfig();
      apiKey = tryDecryptSecret(stored?.apiKeyEnc) ?? "";
      if (!apiKey && parsed.data.provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
      }
    }
    return {
      provider: parsed.data.provider,
      baseUrl: parsed.data.provider === "OPENAI_COMPATIBLE" ? parsed.data.baseUrl?.trim() ?? null : null,
      model: parsed.data.model,
      apiKey,
    };
  }

  // No/invalid body → test the saved config.
  const cfg = await resolveAiConfig();
  return { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey };
}

// Test the AI provider with a minimal call (admin-only). Rate-limited — it makes a
// real upstream request.
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest) => {
    let cfg: TestConfig;
    try {
      cfg = await effectiveConfig(request);
    } catch (e) {
      return err(e instanceof Error ? e.message : "AI provider not configured", 400);
    }

    if (cfg.provider === "ANTHROPIC" && !cfg.apiKey) {
      return err("No API key to test — enter one above, then test.", 400);
    }

    try {
      if (cfg.provider === "ANTHROPIC") {
        const client = new Anthropic({ apiKey: cfg.apiKey });
        await client.messages.create({
          model: cfg.model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with: ok" }],
        });
      } else {
        if (!cfg.baseUrl) return err("Base URL is required for an OpenAI-compatible provider");
        const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: "user", content: "Reply with: ok" }],
            max_tokens: 16,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return err(`Provider returned ${res.status}: ${redactSecret(body, cfg.apiKey).slice(0, 200)}`, 400);
        }
      }
      return ok({ ok: true, provider: cfg.provider, model: cfg.model });
    } catch (e) {
      return err(e instanceof Error ? redactSecret(e.message, cfg.apiKey) : "Connection test failed", 400);
    }
  }),
  { id: "ai-provider-test", limit: 10, windowMs: 60_000 }
);
