import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createRound, listRounds } from "@/lib/hiring/planning";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { createPlanningRoundSchema } from "@/lib/validations/hiring/planning";

/** Step 1 — workforce-planning cycles, per company. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(
        req,
        z.object({ entityId: z.string().max(64).optional() }).passthrough(),
      );
      if ("response" in q) return q.response;
      const page = parsePagination(req.nextUrl.searchParams);
      const { data, total } = await listRounds(actor, q.data.entityId, page);
      return ok(paginatedResponse(data, total, page));
    }),
  ),
  { id: "hiring-planning-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createPlanningRoundSchema);
      if ("response" in body) return body.response;
      return created(await createRound(actor, body.data));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
