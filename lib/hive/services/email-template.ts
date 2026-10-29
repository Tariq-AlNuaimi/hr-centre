import {
  clearTemplateOverride,
  saveTemplateOverride,
  templateOverride,
} from "@/lib/core/email/templates";
// §5.6's default wording lives in the validations module because it has to be
// importable from `prisma/seed-hive.ts`, and THIS file imports `server-only` —
// which throws outside Next, so a seed that reached in here could not run. One
// owner for the words; the boundary decides where it lives.
export { DEFAULT_TEMPLATE } from "@/lib/validations/hive/email-template";
import { DEFAULT_TEMPLATE } from "@/lib/validations/hive/email-template";

/**
 * §5.6's email text, stored rather than compiled (US11, task 5.3).
 *
 * §5.6's requirement is a no-developer one: "the subject line and body wording
 * above are the default, but must be stored as editable template text in the
 * admin panel… so Alaa can reword the subject, opening line, or sign-off later
 * without a developer."
 *
 * The DEFAULT lives here rather than beside the sender, so there is one owner
 * for "what the email says when nobody has edited it". `approveAndSend` reads
 * this; nothing composes a sentence of its own.
 *
 * @public
 */

export interface StoredTemplate {
  key: string;
  subject: string;
  body: string;
  /**
   * True when the stored wording differs from §5.6's default.
   *
   * Derived by COMPARISON rather than by the row's existence, because the row
   * can hold the default text — that is what a reset leaves behind (see
   * {@link resetTemplate}). It is also the truer question for the screen to
   * ask: if the stored text already equals the default, "back to the default"
   * is a button that would do nothing, whether or not a row exists.
   */
  customised: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/**
 * The stored text, or §5.6's default.
 *
 * `customised` is returned because the screen has to be honest about which of
 * the two it is showing: an editor pre-filled with the default looks identical
 * to one showing a saved copy of it, and the difference decides whether "Reset
 * to the default" does anything.
 */
export async function loadTemplate(key: string): Promise<StoredTemplate> {
  // The core template store, module "tickets" (ADR-095).
  const row = await templateOverride("tickets", key);
  if (!row || (!row.subject && !row.body)) {
    return {
      key,
      ...DEFAULT_TEMPLATE,
      customised: false,
      updatedAt: null,
      updatedByName: null,
    };
  }
  const subject = row.subject ?? DEFAULT_TEMPLATE.subject;
  const body = row.body ?? DEFAULT_TEMPLATE.body;
  return {
    key,
    subject,
    body,
    customised: subject !== DEFAULT_TEMPLATE.subject || body !== DEFAULT_TEMPLATE.body,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  };
}

/**
 * Save an edit (audited find-then-write in the core store — never upsert, so
 * the words an employee receives over HR's name always have a trail).
 */
export async function saveTemplate(
  key: string,
  input: { subject: string; body: string },
  userId: string,
): Promise<StoredTemplate> {
  await saveTemplateOverride(
    "tickets",
    key,
    { subject: input.subject, body: input.body, ccRecipients: [] },
    userId,
  );
  return loadTemplate(key);
}

/**
 * Back to §5.6's wording: the override is removed, so the default applies
 * (the core store is not soft-deleted, so a reset can't strand the unique key).
 */
export async function resetTemplate(key: string, _userId: string): Promise<StoredTemplate> {
  await clearTemplateOverride("tickets", key);
  return loadTemplate(key);
}
