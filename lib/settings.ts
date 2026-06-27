import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { encryptSecret, decryptSecret, secretHint } from "@/lib/crypto";
import type { AiSettingsInput } from "@/lib/validations/settings";

// Settings service (ADR-031, UI-SPEC D.10). Owns the per-org AppSetting key/value
// store and the DB-setting-THEN-env precedence for the AI/scoring config. Secrets
// (the endpoint tokens) are stored AES-256-GCM-encrypted (lib/crypto.ts) and are
// WRITE-ONLY: the masked view returns only "is set" + an opaque hint, never the value.
// SERVER-ONLY (reads AUTH_SECRET-derived key material via lib/crypto).

// AppSetting keys. Secret keys go in `valueEncrypted`; everything else in `value`.
export const SETTING_KEYS = {
  llmUrl: "llm.endpointUrl",
  llmModel: "llm.model",
  llmToken: "llm.endpointToken", // secret
  scoringUrl: "scoring.serviceUrl",
  scoringToken: "scoring.serviceToken", // secret
  orgName: "org.name",
  defaultLanguage: "org.defaultLanguage",
  retentionDays: "data.retentionDays",
  brandingAccent: "branding.accent",
} as const;

const SECRET_KEYS = new Set<string>([SETTING_KEYS.llmToken, SETTING_KEYS.scoringToken]);

const DEFAULT_LLM_MODEL = "gpt-oss-120b";

// ---- Low-level get/set ----

/** Read a plaintext setting value for an org (null if unset). */
export async function getAppSetting(orgId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { value: true },
  });
  return row?.value ?? null;
}

/** Read + decrypt a secret setting for an org (null if unset or undecryptable). */
export async function getAppSecret(orgId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { valueEncrypted: true },
  });
  return decryptSecret(row?.valueEncrypted);
}

/**
 * Upsert a setting. A secret key (in SECRET_KEYS) encrypts `value` into
 * `valueEncrypted` (and clears `value`); a non-secret key stores `value` plaintext.
 * Passing `value: null` deletes the setting (falls back to env for the AI keys).
 */
export async function setAppSetting(
  orgId: string,
  key: string,
  value: string | null,
  userId?: string
): Promise<void> {
  // Per-row find + create/update/delete so every write goes through the AUDITED
  // client (upsert/deleteMany bypass the audit extension — ADR-010 / the
  // no-unaudited-bulk-write rule). AppSetting is not soft-deletable, so delete here
  // is a hard delete (still audited by the extension).
  const existing = await prisma.appSetting.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { id: true },
  });

  if (value === null) {
    if (existing) await prisma.appSetting.delete({ where: { id: existing.id } });
    return;
  }

  const isSecret = SECRET_KEYS.has(key);
  const data = isSecret
    ? { value: null, valueEncrypted: encryptSecret(value) }
    : { value, valueEncrypted: null };

  if (existing) {
    await prisma.appSetting.update({
      where: { id: existing.id },
      data: { ...data, updatedById: userId ?? null },
    });
    return;
  }
  try {
    await prisma.appSetting.create({ data: { orgId, key, ...data, updatedById: userId ?? null } });
  } catch (e) {
    // Unique race (a concurrent create won the (orgId,key) slot): fall back to update.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await prisma.appSetting.update({
        where: { orgId_key: { orgId, key } },
        data: { ...data, updatedById: userId ?? null },
      });
      return;
    }
    throw e;
  }
}

// ---- AI / scoring config: DB-then-env precedence ----

export type LlmConfig = { baseUrl: string | null; token: string | null; model: string };
export type ScoringConfig = { url: string | null; token: string | null };

/** Effective LLM config: the org's DB setting wins, else the platform env var. */
export async function resolveLlmConfig(orgId: string): Promise<LlmConfig> {
  const [url, model, token] = await Promise.all([
    getAppSetting(orgId, SETTING_KEYS.llmUrl),
    getAppSetting(orgId, SETTING_KEYS.llmModel),
    getAppSecret(orgId, SETTING_KEYS.llmToken),
  ]);
  return {
    baseUrl: url || process.env.LLM_ENDPOINT_URL || null,
    token: token || process.env.LLM_ENDPOINT_TOKEN || null,
    model: model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
  };
}

/** Effective scoring config: the org's DB setting wins, else the platform env var. */
export async function resolveScoringConfig(orgId: string): Promise<ScoringConfig> {
  const [url, token] = await Promise.all([
    getAppSetting(orgId, SETTING_KEYS.scoringUrl),
    getAppSecret(orgId, SETTING_KEYS.scoringToken),
  ]);
  return {
    url: url || process.env.SCORING_SERVICE_URL || null,
    token: token || process.env.SCORING_SERVICE_TOKEN || null,
  };
}

export async function isLlmConfiguredFor(orgId: string): Promise<boolean> {
  return Boolean((await resolveLlmConfig(orgId)).baseUrl);
}

export async function isScoringConfiguredFor(orgId: string): Promise<boolean> {
  return Boolean((await resolveScoringConfig(orgId)).url);
}

// ---- Masked view for the settings UI (never returns a token) ----

export type ConfigSource = "db" | "env" | "none";

export type AiSettingsView = {
  llm: {
    // The DB OVERRIDE value (what the form input shows; null when only env/none).
    url: string | null;
    // The env fallback, shown as a placeholder/hint so the admin sees the effective
    // value without it being persisted as a DB override on save.
    urlEnv: string | null;
    model: string | null;
    modelEnv: string;
    tokenSet: boolean;
    tokenHint: string | null;
    tokenSource: ConfigSource;
  };
  scoring: {
    url: string | null;
    urlEnv: string | null;
    tokenSet: boolean;
    tokenHint: string | null;
    tokenSource: ConfigSource;
  };
};

/**
 * The masked AI/scoring config for the Settings form. Returns the DB override value
 * (the input value) and the env fallback (a hint) SEPARATELY, plus whether each TOKEN
 * is set (with an opaque hint for a DB token) — but NEVER the token plaintext. Keeping
 * DB and env distinct means saving a prefilled form doesn't silently promote an env
 * value into a DB override.
 */
export async function getAiSettingsView(orgId: string): Promise<AiSettingsView> {
  const rows = await prisma.appSetting.findMany({
    where: { orgId, key: { in: Object.values(SETTING_KEYS) } },
    select: { key: true, value: true, valueEncrypted: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const dbVal = (key: string) => byKey.get(key)?.value ?? null;

  // Token state: a DB ciphertext (with a hint) wins; else env "set" (no hint); else none.
  const token = (key: string, envVal: string | undefined): { set: boolean; hint: string | null; src: ConfigSource } => {
    const enc = byKey.get(key)?.valueEncrypted ?? null;
    if (enc) return { set: true, hint: secretHint(enc), src: "db" };
    if (envVal) return { set: true, hint: null, src: "env" };
    return { set: false, hint: null, src: "none" };
  };

  const llmToken = token(SETTING_KEYS.llmToken, process.env.LLM_ENDPOINT_TOKEN);
  const scoringToken = token(SETTING_KEYS.scoringToken, process.env.SCORING_SERVICE_TOKEN);

  return {
    llm: {
      url: dbVal(SETTING_KEYS.llmUrl),
      urlEnv: process.env.LLM_ENDPOINT_URL ?? null,
      model: dbVal(SETTING_KEYS.llmModel),
      modelEnv: process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
      tokenSet: llmToken.set,
      tokenHint: llmToken.hint,
      tokenSource: llmToken.src,
    },
    scoring: {
      url: dbVal(SETTING_KEYS.scoringUrl),
      urlEnv: process.env.SCORING_SERVICE_URL ?? null,
      tokenSet: scoringToken.set,
      tokenHint: scoringToken.hint,
      tokenSource: scoringToken.src,
    },
  };
}

// ---- Apply an AI-settings form patch (the route calls this) ----

/**
 * Apply a validated AI-settings patch. URLs/model clear on empty string; a token is
 * (re)set ONLY when a non-empty value is sent, or cleared when clear*Token is true —
 * so a blank submit never silently wipes a configured secret.
 */
export async function applyAiSettings(orgId: string, input: AiSettingsInput, userId?: string): Promise<void> {
  const ops: Promise<void>[] = [];
  if (input.llmUrl !== undefined) ops.push(setAppSetting(orgId, SETTING_KEYS.llmUrl, input.llmUrl || null, userId));
  if (input.llmModel !== undefined) ops.push(setAppSetting(orgId, SETTING_KEYS.llmModel, input.llmModel || null, userId));
  if (input.clearLlmToken) ops.push(setAppSetting(orgId, SETTING_KEYS.llmToken, null, userId));
  else if (input.llmToken) ops.push(setAppSetting(orgId, SETTING_KEYS.llmToken, input.llmToken, userId));
  if (input.scoringUrl !== undefined)
    ops.push(setAppSetting(orgId, SETTING_KEYS.scoringUrl, input.scoringUrl || null, userId));
  if (input.clearScoringToken) ops.push(setAppSetting(orgId, SETTING_KEYS.scoringToken, null, userId));
  else if (input.scoringToken) ops.push(setAppSetting(orgId, SETTING_KEYS.scoringToken, input.scoringToken, userId));
  await Promise.all(ops);
}
