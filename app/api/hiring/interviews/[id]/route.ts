import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { interviewDetail } from "@/lib/hiring/interview-views";
import { updateInterview } from "@/lib/hiring/interview-write";
import { loadInterview } from "@/lib/hiring/interviews";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { prisma } from "@/lib/prisma";
import { updateInterviewSchema } from "@/lib/validations/hiring/interview";

/** One interview (judgements withheld from panelists until the reveal). Out of scope = 404. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id);
      if (!l) return notFound("Interview");
      return ok(await interviewDetail(actor, l));
    }),
  ),
  { id: "hiring-interview-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id, "hiring.manage");
      if (!l) return notFound("Interview");
      const body = await parseBody(req, updateInterviewSchema);
      if ("response" in body) return body.response;
      await updateInterview(l, body.data);
      return ok({ id });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id, "hiring.manage");
      if (!l) return notFound("Interview");
      await prisma.hiringInterview.delete({ where: { id } });
      return ok({ id, deleted: true });
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
