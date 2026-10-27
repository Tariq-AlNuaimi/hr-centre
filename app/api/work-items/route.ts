import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { collectWorkItems, type WorkProvider } from "@/lib/core/work-items";
import { hiringWorkProvider } from "@/lib/hiring/work-items";
import { ticketWorkProvider } from "@/lib/hive/services/work-items";
import { jmlWorkProvider } from "@/lib/jml/work-items";

/**
 * Home's "My work" (docs/blueprints/ux-p0.md, US-1): what is waiting on the
 * signed-in person in Joiners & leavers, Hiring and HR tickets. No parameters —
 * the viewer is the session, and each provider applies its own module's
 * permission rules. Performance tasks join on the client, from the same reads
 * the Performance screens use. Bounded: ≤ 20 items per provider.
 */
const PROVIDERS: readonly WorkProvider[] = [
  jmlWorkProvider,
  hiringWorkProvider,
  ticketWorkProvider,
];

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    return ok(await collectWorkItems(session, PROVIDERS));
  }),
  { id: "work-items-read", limit: 120, windowMs: 60_000 },
);
