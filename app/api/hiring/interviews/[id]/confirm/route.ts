import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { confirmAttendance } from "@/lib/hiring/interview-write";
import { loadInterview } from "@/lib/hiring/interviews";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { confirmSchema } from "@/lib/validations/hiring/interview";

/** A panelist confirms (or withdraws) their attendance. */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadInterview(actor, id);
      if (!l) return notFound("Interview");
      const body = await parseBody(req, confirmSchema);
      if ("response" in body) return body.response;
      return ok(await confirmAttendance(actor, id, body.data.confirmed));
    }),
  ),
  { id: "hiring-interviews-write", limit: 60, windowMs: 60_000 },
);
