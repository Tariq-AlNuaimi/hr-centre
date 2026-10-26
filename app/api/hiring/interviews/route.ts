import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { listInterviews } from "@/lib/hiring/interview-views";
import { createInterview } from "@/lib/hiring/interview-write";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import {
  createInterviewSchema,
  interviewListQuerySchema,
} from "@/lib/validations/hiring/interview";

/** Interviews in scope (panel-only readers: their own panels), and scheduling one. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, interviewListQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listInterviews(actor, q.data));
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createInterviewSchema);
      if ("response" in body) return body.response;
      return created(await createInterview(actor, body.data));
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
