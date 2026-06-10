// Vibe Inspector — resolve the active AI provider config (ADR-016).
//
// Order of precedence:
//   1. The singleton AiProviderConfig row (set via Settings), API key decrypted.
//   2. Env fallback: ANTHROPIC_API_KEY + ANTHROPIC_MODEL (the original behaviour),
//      so a fork with only the env var keeps working with zero config.
//
// Throws a clear, actionable error when nothing is configured — the engine turns
// that into a FAILED run (never a false green).

import { prisma } from "@/lib/prisma";
import { tryDecryptSecret } from "@/lib/secret-box";
import type { AiProvider } from "@/generated/prisma/client";

export const AI_CONFIG_ID = "singleton";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

export interface ResolvedAiConfig {
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
  apiKey: string;
  source: "db" | "env";
}

/** A named starting point for the Settings UI. baseUrl is null for ANTHROPIC. */
export interface ProviderPreset {
  id: string;
  label: string;
  provider: AiProvider;
  baseUrl: string | null;
  model: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "rihal-litellm",
    label: "Rihal LiteLLM (self-hosted)",
    provider: "OPENAI_COMPATIBLE",
    baseUrl: "https://litellm.rihal.dev/",
    model: "rihal/openai/gpt-oss-120b",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    provider: "ANTHROPIC",
    baseUrl: null,
    model: DEFAULT_ANTHROPIC_MODEL,
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "OPENAI_COMPATIBLE",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
];

/**
 * Load the stored config row (or null). Used by the settings GET to show current
 * provider/model/baseUrl + a masked key indicator without exposing the key.
 */
export async function getStoredConfig() {
  return prisma.aiProviderConfig.findUnique({ where: { id: AI_CONFIG_ID } });
}

/** Resolve the config to use for an analysis call. Throws if unconfigured. */
export async function resolveAiConfig(): Promise<ResolvedAiConfig> {
  const row = await getStoredConfig();

  if (row) {
    // A saved row is authoritative. Use its stored key; if it can't be decrypted
    // (AUTH_SECRET rotated / corrupt) or none was stored, an Anthropic row falls
    // back to the env key — preserving zero-config and avoiding a hard crash.
    let apiKey = tryDecryptSecret(row.apiKeyEnc) ?? "";
    if (!apiKey && row.provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
      apiKey = process.env.ANTHROPIC_API_KEY;
    }
    return {
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey,
      source: "db",
    };
  }

  // No row yet — env fallback (Anthropic only) keeps the original zero-config path.
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return {
      provider: "ANTHROPIC",
      baseUrl: null,
      model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
      apiKey: envKey,
      source: "env",
    };
  }

  throw new Error(
    "AI provider not configured. Set it in Settings → AI provider, or set ANTHROPIC_API_KEY."
  );
}
