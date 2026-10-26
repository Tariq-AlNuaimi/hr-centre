import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Hiring configuration store — Interview Hub's AppSetting keys, unchanged, on
 * `hiring_settings`. Every write goes through the AUDITED client as
 * find-then-create/update (an upsert would bypass the audit extension —
 * no-unaudited-bulk-write), so a change to an approval chain or the COO
 * threshold is on the audit trail. Secrets (the AI key) are sealed BEFORE they
 * reach this module, so the audit row only ever holds ciphertext, which
 * SCRUB_FIELDS then redacts by name.
 */

export const HIRING_SETTING_KEYS = [
  "approvals.config",
  "assessment.config",
  "budget.envelope",
  "panel.aiMode",
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
  "ai.scoringWeights",
  "comms.flags",
  "careers.dailyCapPerPosition",
  "offerLetter.template",
  "tawteen.targets",
] as const;
export type HiringSettingKey = (typeof HIRING_SETTING_KEYS)[number];

export async function readSetting(key: HiringSettingKey): Promise<unknown> {
  const row = await prisma.hiringSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

/** Many keys in one query (no N+1); absent keys are absent from the map. */
export async function readSettings(
  keys: readonly HiringSettingKey[],
): Promise<Map<string, unknown>> {
  const rows = await prisma.hiringSetting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
    take: keys.length,
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function writeSetting(key: HiringSettingKey, value: Prisma.InputJsonValue) {
  const existing = await prisma.hiringSetting.findUnique({ where: { key }, select: { id: true } });
  if (existing) {
    await prisma.hiringSetting.update({ where: { key }, data: { value }, select: { id: true } });
  } else {
    await prisma.hiringSetting.create({ data: { key, value }, select: { id: true } });
  }
}

/** Pure coercion used by the typed readers. */
export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
