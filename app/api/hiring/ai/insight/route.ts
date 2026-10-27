import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { latestInsight, runInsight } from "@/lib/hiring/ai/insights";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { insightQuerySchema, insightRunSchema } from "@/lib/validations/hiring/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The latest insight of a kind for its record (scope-checked; judgments behind the panel reveal). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, insightQuerySchema);
      if ("response" in q) return q.response;
      return ok(await latestInsight(actor, q.data.kind, q.data.entityId));
    }),
  ),
  { id: "hiring-ai-read", limit: 240, windowMs: 60_000 },
);

/** Run an insight (hiring.manage on the record). Metered, capped and redacted in the engine. */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, insightRunSchema);
      if ("response" in body) return body.response;
      return ok(await runInsight(actor, body.data.kind, body.data.entityId, body.data.transcript));
    }),
  ),
  { id: "hiring-ai-run", limit: 30, windowMs: 60_000 },
);
