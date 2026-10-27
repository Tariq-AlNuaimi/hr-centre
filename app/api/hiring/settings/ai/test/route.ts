import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { isHiringAdmin } from "@/lib/hiring/access";
import { testAiConnection } from "@/lib/hiring/ai/admin";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";

/** A five-token probe of the configured provider (hiring admin; metered; egress-checked). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      return ok(await testAiConnection(actor.userId));
    }),
  ),
  { id: "hiring-ai-test", limit: 10, windowMs: 60_000 },
);
