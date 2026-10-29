import type { Prisma } from "@/generated/prisma/client";
import {
  readModuleSetting,
  readModuleSettings,
  writeModuleSetting,
} from "@/lib/core/settings/store";

/**
 * Hiring configuration — Interview Hub's AppSetting keys, unchanged, on the
 * core settings store (module "hiring", ADR-092). Every write goes through the AUDITED client as
 * find-then-create/update (an upsert would bypass the audit extension —
 * no-unaudited-bulk-write), so a change to an approval chain or the COO
 * threshold is on the audit trail. Secrets (the AI key) are sealed BEFORE they
 * reach this module, so the audit row only ever holds ciphertext, which
 * SCRUB_FIELDS then redacts by name.
 */

// The AI provider, key and limits are platform settings now (lib/core/ai, ADR-097).
const HIRING_SETTING_KEYS = [
  "approvals.config",
  "assessment.config",
  "budget.envelope",
  "panel.aiMode",
  "ai.scoringWeights",
  "comms.flags",
  "careers.dailyCapPerPosition",
  "offerLetter.template",
  "tawteen.targets",
] as const;
export type HiringSettingKey = (typeof HIRING_SETTING_KEYS)[number];

export function readSetting(key: HiringSettingKey): Promise<unknown> {
  return readModuleSetting("hiring", key);
}

/** Many keys in one query (no N+1); absent keys are absent from the map. */
export function readSettings(keys: readonly HiringSettingKey[]): Promise<Map<string, unknown>> {
  return readModuleSettings("hiring", keys);
}

export function writeSetting(key: HiringSettingKey, value: Prisma.InputJsonValue) {
  return writeModuleSetting("hiring", key, value);
}

/** Pure coercion used by the typed readers. */
export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
