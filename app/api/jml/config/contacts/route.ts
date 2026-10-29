import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { contactSettings, saveContactSettings } from "@/lib/jml/desks";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { contactSettingsSchema } from "@/lib/validations/jml/config";

/** Desk addresses and case links — HR settings on the core store (ADR-092), env as fallback. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => (requireGroup(actor, "jml.configure"), ok(await contactSettings()))),
  ),
  { id: "jml-contacts-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor, session }) => {
      requireGroup(actor, "jml.configure");
      const input = await body(req, contactSettingsSchema);
      return ok(await saveContactSettings(input, session.user.id));
    }),
  ),
  { id: "jml-contacts-write", limit: 30, windowMs: 60_000 },
);
