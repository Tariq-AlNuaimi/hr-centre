import type { NextRequest } from "next/server";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { loadTemplate, resetTemplate, saveTemplate } from "@/lib/hive/services/email-template";
import { emailTemplateSchema, templateKeySchema } from "@/lib/validations/hive/email-template";

/**
 * §5.6's Email Template screen (US11, task 5.3).
 *
 * Gated on `canEditContent`, not ADMIN. §5.6 puts this in "the admin panel
 * (Content Editor or a dedicated Email Template screen)" and the wording of an
 * email HR sends is content by every reasonable reading — Alaa and Muna hold the
 * permission, the five standard accounts do not.
 *
 * The key is validated against a closed enum rather than passed through: it
 * addresses a row, and an open string would let this route read or write any
 * `EmailTemplate` a future feature adds, including ones with a different gate.
 */

function parseKey(raw: string) {
  return templateKeySchema.safeParse(raw);
}

export const GET = withAuth(
  requireHivePermission("editContent", async (_req, ctx) => {
    const key = parseKey((await ctx.params).key);
    if (!key.success) return err("Not found.", 404);
    return ok(await loadTemplate(key.data));
  }),
);

export const PUT = withAuth(
  requireHivePermission("editContent", async (req: NextRequest, ctx) => {
    const key = parseKey((await ctx.params).key);
    if (!key.success) return err("Not found.", 404);

    const parsed = emailTemplateSchema.safeParse(await readJsonBody(req));
    // The message is surfaced verbatim because the interesting failure here is
    // the missing `{{answer}}`, and its message names the consequence. A generic
    // "invalid template" would leave the editor guessing at which of two fields
    // and which of several rules.
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid template.", 400);

    return ok(await saveTemplate(key.data, parsed.data, ctx.session.user.id));
  }),
);

/** Back to §5.6's wording. */
export const DELETE = withAuth(
  requireHivePermission("editContent", async (_req, ctx) => {
    const key = parseKey((await ctx.params).key);
    if (!key.success) return err("Not found.", 404);
    return ok(await resetTemplate(key.data, ctx.session.user.id));
  }),
);
