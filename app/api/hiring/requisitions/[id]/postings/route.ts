import type { HiringPostingChannel } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { postChannel, postingConsole, withdrawChannel } from "@/lib/hiring/postings";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { postingSchema, withdrawPostingSchema } from "@/lib/validations/hiring/requisition";

/** Step 4 — posting console / post a channel / withdraw (`?channel=`). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      return ok(await postingConsole(l));
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, postingSchema);
      if ("response" in body) return body.response;
      await postChannel(actor, l, {
        ...body.data,
        channel: body.data.channel as HiringPostingChannel,
      });
      return ok(await postingConsole(l));
    }),
  ),
  { id: "hiring-posting-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const q = parseQuery(req, withdrawPostingSchema);
      if ("response" in q) return q.response;
      await withdrawChannel(actor, l, q.data.channel as HiringPostingChannel);
      return ok(await postingConsole(l));
    }),
  ),
  { id: "hiring-posting-write", limit: 60, windowMs: 60_000 },
);
