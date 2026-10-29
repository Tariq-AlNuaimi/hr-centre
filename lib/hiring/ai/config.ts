import { cache } from "react";
import { openSecretSetting } from "../comp-crypto";
import { readPlatformAiSettings } from "@/lib/core/ai/settings";
import { asNumber } from "../settings";

/**
 * Where the AI engine points (Interview Hub `getAiConfig`). Platform settings
 * first (Admin › Settings › AI, ADR-097), then the env fallback AI_PROVIDER /
 * AI_BASE_URL / AI_MODEL / AI_API_KEY. The stored key is an ADR-067 envelope
 * under the hiring key; one that will not open reads as "no key" — AI is then
 * off, never pointed somewhere with a garbled credential. Nothing here is ever
 * logged or returned to a client: `publicAiConfig` is the client view.
 */

type AiProvider = "anthropic" | "openai";
export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  keySource: "settings" | "env" | null;
};

const DEFAULTS: Record<AiProvider, { baseUrl: string; model: string }> = {
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
  // No vendor URL by default: an OpenAI-compatible gateway (LiteLLM, vLLM…) must be named.
  openai: { baseUrl: "", model: "" },
};

const readAiSettings = cache(async () => readPlatformAiSettings());

/**
 * The key is stored as `{ apiKey: <envelope> }`: the audit extension scrubs a
 * field NAMED apiKey at any depth, so the settings audit row records that the
 * key changed and never a copy of the ciphertext.
 */
export const sealedKeyOf = (v: unknown): string | null => {
  const k = (v as { apiKey?: unknown } | null)?.apiKey;
  return typeof k === "string" && k ? k : null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const getAiConfig = cache(async (): Promise<AiConfig> => {
  const s = await readAiSettings();
  const raw = str(s.get("ai.provider")) ?? str(process.env.AI_PROVIDER) ?? "openai";
  const provider: AiProvider = raw === "anthropic" ? "anthropic" : "openai";
  const baseUrl =
    str(s.get("ai.baseUrl")) ?? str(process.env.AI_BASE_URL) ?? DEFAULTS[provider].baseUrl;
  const model = str(s.get("ai.model")) ?? str(process.env.AI_MODEL) ?? DEFAULTS[provider].model;
  const sealed = sealedKeyOf(s.get("ai.apiKey"));
  if (sealed)
    return {
      provider,
      baseUrl,
      model,
      apiKey: openSecretSetting("ai.apiKey", sealed),
      keySource: "settings",
    };
  const envKey = str(process.env.AI_API_KEY);
  return { provider, baseUrl, model, apiKey: envKey, keySource: envKey ? "env" : null };
});

/** Usable = a key that opens, a base URL and a model. */
export async function aiConfigured(): Promise<boolean> {
  const c = await getAiConfig();
  return Boolean(c.apiKey && c.baseUrl && c.model);
}

export async function aiSupportsPdf(): Promise<boolean> {
  const c = await getAiConfig();
  if (!c.apiKey) return false;
  if (c.provider === "anthropic") return true;
  const flag = (await readAiSettings()).get("ai.pdfVision");
  return flag === true || flag === "true";
}

export type AiLimits = {
  killSwitch: boolean;
  dailyTokenCap: number;
  dailySpendCap: number;
  timeoutMs: number;
  pricePer1kIn: number;
  pricePer1kOut: number;
};

export async function getAiLimits(): Promise<AiLimits> {
  const s = await readAiSettings();
  const timeout = asNumber(s.get("ai.timeoutMs"), 60_000);
  return {
    killSwitch: s.get("ai.killSwitch") === true || s.get("ai.killSwitch") === "true",
    dailyTokenCap: Math.max(0, asNumber(s.get("ai.dailyTokenCap"), 0)),
    dailySpendCap: Math.max(0, asNumber(s.get("ai.dailySpendCap"), 0)),
    timeoutMs: timeout >= 1000 && timeout <= 300_000 ? timeout : 60_000,
    pricePer1kIn: Math.max(0, asNumber(s.get("ai.pricePer1kIn"), 0)),
    pricePer1kOut: Math.max(0, asNumber(s.get("ai.pricePer1kOut"), 0)),
  };
}

/** What the settings screen may show: never the key, only whether one is set and from where. */
export async function publicAiConfig() {
  const c = await getAiConfig();
  const s = await readAiSettings();
  return {
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    keySet: Boolean(c.apiKey),
    keySource: c.keySource,
    keyUnreadable: c.keySource === "settings" && !c.apiKey,
    pdfVision: s.get("ai.pdfVision") === true || s.get("ai.pdfVision") === "true",
    configured: Boolean(c.apiKey && c.baseUrl && c.model),
  };
}
