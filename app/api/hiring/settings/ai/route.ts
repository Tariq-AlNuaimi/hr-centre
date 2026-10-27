import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere, isHiringAdmin } from "@/lib/hiring/access";
import { saveAiProvider } from "@/lib/hiring/ai/admin";
import { publicAiConfig } from "@/lib/hiring/ai/config";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { aiProviderSchema } from "@/lib/validations/hiring/ai";

/** The AI provider. Read: HR (no key, ever — only whether one is set); change: hiring admin. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      return ok({ ...(await publicAiConfig()), canEdit: isHiringAdmin(actor) });
    }),
  ),
  { id: "hiring-settings-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!isHiringAdmin(actor)) return forbidden();
      const body = await parseBody(req, aiProviderSchema);
      if ("response" in body) return body.response;
      await saveAiProvider(body.data);
      return ok({ ...(await publicAiConfig()), canEdit: true });
    }),
  ),
  { id: "hiring-settings-write", limit: 30, windowMs: 60_000 },
);
