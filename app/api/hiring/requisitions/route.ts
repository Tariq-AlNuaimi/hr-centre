import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { listRequisitions } from "@/lib/hiring/requisitions";
import { createRequisition } from "@/lib/hiring/requisition-write";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import {
  createRequisitionSchema,
  requisitionListQuerySchema,
} from "@/lib/validations/hiring/requisition";

/** Requisitions (Interview Hub `/api/positions`): scoped list; create checks the target company. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, requisitionListQuerySchema);
      if ("response" in q) return q.response;
      const page = parsePagination(req.nextUrl.searchParams);
      const { data, total } = await listRequisitions(actor, q.data, page);
      return ok(paginatedResponse(data, total, page));
    }),
  ),
  { id: "hiring-requisitions-list", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createRequisitionSchema);
      if ("response" in body) return body.response;
      return created(await createRequisition(actor, body.data));
    }),
  ),
  { id: "hiring-requisitions-write", limit: 60, windowMs: 60_000 },
);
