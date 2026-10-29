import type { NextRequest } from "next/server";
import type { NotificationKind } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { preferencesFor, savePreferences } from "@/lib/core/notify/preferences";
import { preferencesSchema } from "@/lib/validations/core/notifications";

/** The viewer's own notification preferences (ADR-095). Nobody edits another person's. */
export const GET = withRateLimit(
  withAuth(async (_req: NextRequest, { session }) => ok(await preferencesFor(session.user.id))),
  { id: "notification-preferences-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(async (req: NextRequest, { session }) => {
    const parsed = preferencesSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return err("Invalid preferences", 422);
    return ok(
      await savePreferences(
        session.user.id,
        parsed.data.preferences.map((p) => ({ ...p, kind: p.kind as NotificationKind })),
      ),
    );
  }),
  { id: "notification-preferences-write", limit: 30, windowMs: 60_000 },
);
