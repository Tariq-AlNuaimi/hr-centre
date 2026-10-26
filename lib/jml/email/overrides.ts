import { prisma } from "@/lib/prisma";
import { TEMPLATES, findTemplate, type EmailTemplate } from "./templates";

// -- §14's template administration (overrides) --------------------------------
//
// Added 2026-08-28. Until then this screen was READ-ONLY: it rendered §11.2's
// approved copy against a sample context and had no POST/PUT/PATCH, which the
// clause-level audit recorded as one of §14's four unbuilt areas.
//
// The override layer is deliberately thin. `TEMPLATES` above is still the only
// place the approved text lives; a row in `email_template_overrides` shadows one
// field of one template, and deleting the row restores the approved text. The
// alternative — copying all ten rows into the database at first edit — would
// make §11.2's content unrecoverable the moment somebody saved.

export interface ResolvedTemplate extends EmailTemplate {
  /** Additional addresses on top of the fixed §11.2 audience. */
  ccRecipients: string[];
  /** Which fields an administrator has overridden, for the "reset" affordance. */
  overridden: Array<"subject" | "body" | "ccRecipients">;
  updatedAt: Date | null;
  updatedByName: string | null;
}

const OVERRIDE_SELECT = {
  type: true,
  subject: true,
  body: true,
  ccRecipients: true,
  updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

/** §11.2's ten rows, with any administrator overrides applied. */
export async function resolveTemplates(): Promise<ResolvedTemplate[]> {
  const overrides = await prisma.jmlEmailTemplateOverride.findMany({
    select: OVERRIDE_SELECT,
    // Bounded by construction: `type` is unique and only a §11.2 row may own
    // one, so there can never be more rows than there are templates.
    take: TEMPLATES.length,
  });
  const byType = new Map(overrides.map((row) => [row.type, row]));
  return TEMPLATES.map((template) => applyOverride(template, byType.get(template.type)));
}

/** One template, resolved. `undefined` when the type is not a §11.2 row. */
export async function resolveTemplate(type: string): Promise<ResolvedTemplate | undefined> {
  const template = findTemplate(type);
  if (!template) return undefined;
  const override = await prisma.jmlEmailTemplateOverride.findUnique({
    where: { type },
    select: OVERRIDE_SELECT,
  });
  return applyOverride(template, override ?? undefined);
}

type OverrideRow = {
  subject: string | null;
  body: string | null;
  ccRecipients: string[];
  updatedAt: Date;
  updatedBy: { name: string | null } | null;
};

function applyOverride(template: EmailTemplate, override?: OverrideRow): ResolvedTemplate {
  const overridden: ResolvedTemplate["overridden"] = [];
  if (override?.subject) overridden.push("subject");
  if (override?.body) overridden.push("body");
  if (override?.ccRecipients.length) overridden.push("ccRecipients");

  return {
    ...template,
    subject: override?.subject ?? template.subject,
    body: override?.body ?? template.body,
    ccRecipients: override?.ccRecipients ?? [],
    overridden,
    updatedAt: override?.updatedAt ?? null,
    updatedByName: override?.updatedBy?.name ?? null,
  };
}

/**
 * Save an administrator's edit.
 *
 * `null` on a field CLEARS that override — the approved §11.2 text applies
 * again. `undefined` leaves it alone. A screen that could only write strings
 * would have no way to un-edit, which is why the boundary schema distinguishes
 * the two.
 *
 * When every override is cleared the ROW IS DELETED rather than left as a shell
 * of nulls, so `overridden` is empty and the screen honestly reads "matches the
 * approved template".
 */
export async function saveTemplateOverride(
  type: string,
  input: { subject?: string | null; body?: string | null; ccRecipients?: string[] },
  actorId: string,
): Promise<ResolvedTemplate | undefined> {
  const template = findTemplate(type);
  if (!template) return undefined;

  const current = await prisma.jmlEmailTemplateOverride.findUnique({
    where: { type },
    select: { subject: true, body: true, ccRecipients: true },
  });

  const next = {
    subject: input.subject === undefined ? (current?.subject ?? null) : input.subject,
    body: input.body === undefined ? (current?.body ?? null) : input.body,
    ccRecipients: input.ccRecipients ?? current?.ccRecipients ?? [],
  };

  if (!next.subject && !next.body && next.ccRecipients.length === 0) {
    if (current) await prisma.jmlEmailTemplateOverride.delete({ where: { type } });
    return resolveTemplate(type);
  }

  // Find-then-write rather than `upsert`. Prisma's `upsert` bypasses the audit
  // extension entirely (ADR-010 / `no-unaudited-bulk-write`), and an edit to
  // outbound candidate copy is exactly the configuration change §14's audit
  // requirement is about. The `current` lookup above already told us which
  // branch this is, so it costs no extra query.
  if (current) {
    await prisma.jmlEmailTemplateOverride.update({
      where: { type },
      data: { ...next, updatedById: actorId },
      select: { id: true },
    });
  } else {
    await prisma.jmlEmailTemplateOverride.create({
      data: { type, ...next, updatedById: actorId },
      select: { id: true },
    });
  }
  return resolveTemplate(type);
}

/**
 * Drop every override for a template — "reset to the approved version".
 *
 * A single `delete` after a lookup rather than `deleteMany`, even though `type`
 * is unique and both would remove exactly one row. `deleteMany` is invisible to
 * the app-level audit extension (ADR-010's accepted bulk blind spot), and
 * discarding an administrator's edit is precisely the kind of configuration
 * change §14's audit requirement exists to record.
 */
export async function resetTemplateOverride(type: string): Promise<ResolvedTemplate | undefined> {
  if (!findTemplate(type)) return undefined;
  const existing = await prisma.jmlEmailTemplateOverride.findUnique({
    where: { type },
    select: { id: true },
  });
  if (existing) await prisma.jmlEmailTemplateOverride.delete({ where: { type } });
  return resolveTemplate(type);
}
