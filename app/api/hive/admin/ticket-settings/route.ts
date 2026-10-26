import type { NextRequest } from "next/server";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { getTicketSettings, updateTicketSettings } from "@/lib/hive/services/ticket-settings";
import { ticketSettingsSchema } from "@/lib/validations/hive/ticket-settings";

/**
 * Spec V2 §8.8 Settings (blueprint T5): the ticket ID prefix and status labels.
 *
 * Gated on Edit content, the same permission as the email template beside it on
 * the Settings screen. Reading the values for display does NOT come through
 * here: every ticket response carries them, so See tickets is enough to render
 * an ID; this route is the editor.
 */
export const GET = withAuth(
  requireHivePermission("editContent", async () => ok(await getTicketSettings())),
);

export const PUT = withAuth(
  requireHivePermission("editContent", async (req: NextRequest, ctx) => {
    const parsed = ticketSettingsSchema.safeParse(await readJsonBody(req));
    // Verbatim: the prefix rule's message says what is allowed.
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid settings.", 400);
    return ok(await updateTicketSettings(parsed.data, ctx.session.user.id));
  }),
);
