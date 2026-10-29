import {
  clearTemplateOverride,
  saveTemplateOverride as saveCoreOverride,
  templateOverride,
  templateOverrides,
} from "@/lib/core/email/templates";
import { TEMPLATES, findTemplate, type EmailTemplate } from "./templates";

// -- §14's template administration (overrides) --------------------------------
//
// Added 2026-08-28. Until then this screen was READ-ONLY: it rendered §11.2's
// approved copy against a sample context and had no POST/PUT/PATCH, which the
// clause-level audit recorded as one of §14's four unbuilt areas.
//
// Overrides live in the core template store (module "jml", ADR-095).
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

/** §11.2's ten rows, with any administrator overrides applied. */
export async function resolveTemplates(): Promise<ResolvedTemplate[]> {
  const byType = await templateOverrides(
    "jml",
    TEMPLATES.map((t) => t.type),
  );
  return TEMPLATES.map((template) => applyOverride(template, byType.get(template.type)));
}

/** One template, resolved. `undefined` when the type is not a §11.2 row. */
export async function resolveTemplate(type: string): Promise<ResolvedTemplate | undefined> {
  const template = findTemplate(type);
  if (!template) return undefined;
  const override = await templateOverride("jml", type);
  return applyOverride(template, override ?? undefined);
}

type OverrideRow = {
  subject: string | null;
  body: string | null;
  ccRecipients: string[];
  updatedAt: Date;
  updatedByName: string | null;
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
    updatedByName: override?.updatedByName ?? null,
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

  const current = await templateOverride("jml", type);

  const next = {
    subject: input.subject === undefined ? (current?.subject ?? null) : input.subject,
    body: input.body === undefined ? (current?.body ?? null) : input.body,
    ccRecipients: input.ccRecipients ?? current?.ccRecipients ?? [],
  };

  // Every override cleared deletes the row (the store does it); find-then-write,
  // never upsert, so the edit is on the audit trail.
  await saveCoreOverride("jml", type, next, actorId);
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
  await clearTemplateOverride("jml", type);
  return resolveTemplate(type);
}
