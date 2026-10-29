import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The platform's one configuration store (ADR-092): `ModuleSetting(module, key,
 * value)`. A module never defines its own settings table; it names its keys and
 * validates values with its own zod schema on read and write.
 *
 * Every write goes through the AUDITED client as find-then-update/create — an
 * upsert would bypass the audit extension (ADR-010) — so who changed a setting,
 * from what to what, is on the audit trail. Secret values are sealed by the
 * caller BEFORE they reach this store, so audit rows only ever hold ciphertext.
 *
 * Modules in use: `hiring` (Interview Hub's AppSetting keys), `tickets` (prefix,
 * labels, answer-by hours), `jml` (desk addresses and external links).
 */

export type SettingModule = "hiring" | "tickets" | "jml" | "platform";

export async function readModuleSetting(module: SettingModule, key: string): Promise<unknown> {
  const row = await prisma.moduleSetting.findUnique({
    where: { module_key: { module, key } },
    select: { value: true },
  });
  return row?.value ?? null;
}

/** Many keys in one query (no N+1); absent keys are absent from the map. */
export async function readModuleSettings(
  module: SettingModule,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.moduleSetting.findMany({
    where: { module, key: { in: [...keys] } },
    select: { key: true, value: true },
    take: keys.length,
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Write one setting. Two editors racing the very first save is the only window
 * where the create can collide; the loser's P2002 retries as an update.
 */
export async function writeModuleSetting(
  module: SettingModule,
  key: string,
  value: Prisma.InputJsonValue,
  updatedById: string | null = null,
): Promise<void> {
  const where = { module_key: { module, key } };
  const existing = await prisma.moduleSetting.findUnique({ where, select: { id: true } });
  if (existing) {
    await prisma.moduleSetting.update({
      where: { id: existing.id },
      data: { value, updatedById },
      select: { id: true },
    });
    return;
  }
  try {
    await prisma.moduleSetting.create({
      data: { module, key, value, updatedById },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    await prisma.moduleSetting.update({
      where,
      data: { value, updatedById },
      select: { id: true },
    });
  }
}

/** Remove a setting so its reader falls back to the default. */
export async function clearModuleSetting(module: SettingModule, key: string): Promise<void> {
  const existing = await prisma.moduleSetting.findUnique({
    where: { module_key: { module, key } },
    select: { id: true },
  });
  if (existing) await prisma.moduleSetting.delete({ where: { id: existing.id } });
}
