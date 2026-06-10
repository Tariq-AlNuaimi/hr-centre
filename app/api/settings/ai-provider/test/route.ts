import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { resolveAiConfig } from "@/lib/testing/ai-config";
import { redactSecret } from "@/lib/secret-box";

export const maxDuration = 30;

// Test the SAVED AI provider config with a minimal call (admin-only). Save first,
// then test. Rate-limited — it makes a real upstream request.
export const POST = withRateLimit(
  withAdminAuth(async (_request: NextRequest) => {
    let cfg;
    try {
      cfg = await resolveAiConfig();
    } catch (e) {
      return err(e instanceof Error ? e.message : "AI provider not configured", 400);
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
      return err(e instanceof Error ? e.message : "Connection test failed", 400);
    }
  }),
  { id: "ai-provider-test", limit: 10, windowMs: 60_000 }
);
