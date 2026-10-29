import type { NotificationKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_REGISTRY,
  effectivePreference,
  type Preference,
} from "./registry";

/**
 * Per-person notification preferences (ADR-095). Read on every write of a
 * notification and every per-person email a module sends; edited by the
 * person on Settings › Profile. Mandatory kinds ignore the stored choice.
 */

const MAX_ROWS = 5000;

export type PreferenceRow = Preference & {
  kind: NotificationKind;
  module: (typeof NOTIFICATION_REGISTRY)[NotificationKind]["module"];
  mandatory: boolean;
  hasEmail: boolean;
};

/** Every kind with the person's effective choice, in registry order. */
export async function preferencesFor(userId: string): Promise<PreferenceRow[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { kind: true, inApp: true, email: true },
    take: NOTIFICATION_KINDS.length,
  });
  const stored = new Map(rows.map((r) => [r.kind, r]));
  return NOTIFICATION_KINDS.map((kind) => {
    const info = NOTIFICATION_REGISTRY[kind];
    return {
      kind,
      module: info.module,
      mandatory: info.mandatory,
      hasEmail: info.email,
      ...effectivePreference(kind, stored.get(kind)),
    };
  });
}

/** Save the person's choices (mandatory kinds are ignored). Audited per row. */
export async function savePreferences(
  userId: string,
  choices: ReadonlyArray<{ kind: NotificationKind; inApp: boolean; email: boolean }>,
): Promise<PreferenceRow[]> {
  for (const c of choices) {
    if (NOTIFICATION_REGISTRY[c.kind].mandatory) continue;
    const where = { userId_kind: { userId, kind: c.kind } };
    const existing = await prisma.notificationPreference.findUnique({
      where,
      select: { id: true },
    });
    const data = { inApp: c.inApp, email: c.email };
    if (existing)
      await prisma.notificationPreference.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
    else
      await prisma.notificationPreference.create({
        data: { userId, kind: c.kind, ...data },
        select: { id: true },
      });
  }
  return preferencesFor(userId);
}

/** Which (user, kind) pairs have muted the channel — one query, non-mandatory kinds only. */
async function muted(
  userIds: readonly string[],
  kinds: readonly NotificationKind[],
  channel: "inApp" | "email",
): Promise<Set<string>> {
  const optional = kinds.filter((k) => !NOTIFICATION_REGISTRY[k].mandatory);
  if (userIds.length === 0 || optional.length === 0) return new Set();
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: [...userIds] }, kind: { in: optional }, [channel]: false },
    select: { userId: true, kind: true },
    take: MAX_ROWS,
  });
  return new Set(rows.map((r) => `${r.userId}:${r.kind}`));
}

export function mutedInApp(userIds: readonly string[], kinds: readonly NotificationKind[]) {
  return muted(userIds, kinds, "inApp");
}

/** The people who still want this kind's email. */
export async function wantEmail(
  userIds: readonly string[],
  kind: NotificationKind,
): Promise<string[]> {
  const off = await muted(userIds, [kind], "email");
  return userIds.filter((id) => !off.has(`${id}:${kind}`));
}
