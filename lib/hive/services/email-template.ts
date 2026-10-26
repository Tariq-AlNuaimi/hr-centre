import { prisma } from "@/lib/prisma";
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
  const row = await prisma.hiveEmailTemplate.findUnique({
    where: { key },
    select: {
      subject: true,
      body: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
    },
  });
  if (!row) {
    return {
      key,
      ...DEFAULT_TEMPLATE,
      customised: false,
      updatedAt: null,
      updatedByName: null,
    };
  }
  return {
    key,
    subject: row.subject,
    body: row.body,
    customised: row.subject !== DEFAULT_TEMPLATE.subject || row.body !== DEFAULT_TEMPLATE.body,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedBy?.name ?? null,
  };
}

/**
 * Save an edit.
 *
 * Read-then-write rather than `upsert`: the audit extension hooks `create`,
 * `update` and `delete` and NOT `upsert`, so an upsert here would change the
 * words an employee receives over HR's name and leave no trail of who changed
 * them.
 */
export async function saveTemplate(
  key: string,
  input: { subject: string; body: string },
  userId: string,
): Promise<StoredTemplate> {
  const existing = await prisma.hiveEmailTemplate.findUnique({
    where: { key },
    select: { id: true },
  });
  if (existing) {
    await prisma.hiveEmailTemplate.update({
      where: { key },
      data: { subject: input.subject, body: input.body, updatedById: userId },
      select: { id: true },
    });
  } else {
    await prisma.hiveEmailTemplate.create({
      data: { key, subject: input.subject, body: input.body, updatedById: userId },
      select: { id: true },
    });
  }
  return loadTemplate(key);
}

/**
 * Back to §5.6's wording.
 *
 * **Writes the default text; does not delete the row.** `EmailTemplate` is in
 * the soft-delete set, so `delete` here would set `deletedAt` and leave the row
 * in place — still holding `key`, which is `@unique`. Every read on the filtered
 * client would then miss it (so the screen would look reset, correctly) and the
 * next save would `create` a second row with the same key and fail on the unique
 * constraint. A reset would have permanently bricked editing, and only for
 * someone who reset and then changed their mind.
 *
 * That is also why `customised` is a comparison rather than "does a row exist":
 * after a reset the row exists and holds the default, and there is nothing left
 * to reset.
 */
export async function resetTemplate(key: string, userId: string): Promise<StoredTemplate> {
  const existing = await prisma.hiveEmailTemplate.findUnique({
    where: { key },
    select: { id: true },
  });
  if (existing) {
    await prisma.hiveEmailTemplate.update({
      where: { key },
      data: { ...DEFAULT_TEMPLATE, updatedById: userId },
      select: { id: true },
    });
  }
  return loadTemplate(key);
}
