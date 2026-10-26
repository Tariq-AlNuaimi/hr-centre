import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { addPanelist, removePanelist } from "@/lib/hiring/interview-write";
import { loadInterview } from "@/lib/hiring/interviews";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { panelistSchema } from "@/lib/validations/hiring/interview";

/** Add a panelist (recusal + hiring access checked) or remove one (`?userId=`; always allowed — D8). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id, "hiring.manage");
      if (!l) return notFound("Interview");
      const body = await parseBody(req, panelistSchema);
      if ("response" in body) return body.response;
      await addPanelist(l, body.data.userId);
      return ok({ id, userId: body.data.userId });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id, "hiring.manage");
      if (!l) return notFound("Interview");
      const q = parseQuery(req, panelistSchema);
      if ("response" in q) return q.response;
      await removePanelist(l, q.data.userId);
      return ok({ id, userId: q.data.userId, removed: true });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
