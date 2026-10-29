import { prisma } from "@/lib/prisma";

/**
 * The platform's one email-template store (ADR-095). A module owns its default
 * wording in code; `core_email_templates` holds an administrator's override of
 * one template (subject / body / cc). No row means the default applies, so a
 * reset is a delete and a fresh database needs no seed.
 *
 * Writes are audited find-then-write (no upsert, ADR-010): who changed the words
 * an employee or candidate receives is on the trail.
 */

export type TemplateModule = "jml" | "tickets" | "hiring" | "performance";

export type TemplateOverride = {
  key: string;
  subject: string | null;
  body: string | null;
  ccRecipients: string[];
  updatedAt: Date;
  updatedByName: string | null;
};

const SELECT = {
  key: true,
  subject: true,
  body: true,
  ccRecipients: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

type Row = {
  key: string;
  subject: string | null;
  body: string | null;
  ccRecipients: string[];
  updatedAt: Date;
  updatedBy: { name: string | null } | null;
};

const toOverride = (r: Row): TemplateOverride => ({
  key: r.key,
  subject: r.subject,
  body: r.body,
  ccRecipients: r.ccRecipients,
  updatedAt: r.updatedAt,
  updatedByName: r.updatedBy?.name ?? null,
});

export async function templateOverride(
  module: TemplateModule,
  key: string,
): Promise<TemplateOverride | null> {
  const row = await prisma.emailTemplate.findUnique({
    where: { module_key: { module, key } },
    select: SELECT,
  });
  return row ? toOverride(row) : null;
}

/** A module's overrides for these keys, in one query. */
export async function templateOverrides(
  module: TemplateModule,
  keys: readonly string[],
): Promise<Map<string, TemplateOverride>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.emailTemplate.findMany({
    where: { module, key: { in: [...keys] } },
    select: SELECT,
    take: keys.length,
  });
  return new Map(rows.map((r) => [r.key, toOverride(r)]));
}

/**
 * Save an override. Every field empty (no subject, no body, no cc) deletes the
 * row, so the screen honestly reads "matches the default".
 */
export async function saveTemplateOverride(
  module: TemplateModule,
  key: string,
  next: { subject: string | null; body: string | null; ccRecipients: string[] },
  updatedById: string,
): Promise<void> {
  const where = { module_key: { module, key } };
  const existing = await prisma.emailTemplate.findUnique({ where, select: { id: true } });
  if (!next.subject && !next.body && next.ccRecipients.length === 0) {
    if (existing) await prisma.emailTemplate.delete({ where: { id: existing.id } });
    return;
  }
  const data = { ...next, updatedById };
  if (existing) {
    await prisma.emailTemplate.update({ where: { id: existing.id }, data, select: { id: true } });
  } else {
    await prisma.emailTemplate.create({ data: { module, key, ...data }, select: { id: true } });
  }
}

/** Back to the module's default wording. */
export async function clearTemplateOverride(module: TemplateModule, key: string): Promise<void> {
  const existing = await prisma.emailTemplate.findUnique({
    where: { module_key: { module, key } },
    select: { id: true },
  });
  if (existing) await prisma.emailTemplate.delete({ where: { id: existing.id } });
}
