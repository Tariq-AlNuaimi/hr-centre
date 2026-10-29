import type { Prisma } from "@/generated/prisma/client";
import { readModuleSettings, writeModuleSetting } from "@/lib/core/settings/store";

/**
 * Platform AI settings (ADR-097): the provider, key, model and limits every
 * module's AI uses — today Hiring's insights and CV/JD reading; HR-ticket answer
 * drafting can read the same. Stored on the core settings store under module
 * "platform"; the key is sealed by the caller before it reaches the store.
 */

const PLATFORM_AI_KEYS = [
  "ai.provider",
  "ai.baseUrl",
  "ai.model",
  "ai.apiKey",
  "ai.pdfVision",
  "ai.killSwitch",
  "ai.dailyTokenCap",
  "ai.dailySpendCap",
  "ai.timeoutMs",
  "ai.pricePer1kIn",
  "ai.pricePer1kOut",
] as const;
export type PlatformAiKey = (typeof PLATFORM_AI_KEYS)[number];

export function readPlatformAiSettings(): Promise<Map<string, unknown>> {
  return readModuleSettings("platform", PLATFORM_AI_KEYS);
}

export function writePlatformAiSetting(key: PlatformAiKey, value: Prisma.InputJsonValue) {
  return writeModuleSetting("platform", key, value);
}
