import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { screenChunk, screenStatus } from "@/lib/hiring/ai/screen";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { aiScreenChunkSchema } from "@/lib/validations/hiring/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many new applicants are waiting for an AI fit score. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      return ok(await screenStatus(l));
    }),
  ),
  { id: "hiring-ai-read", limit: 240, windowMs: 60_000 },
);

/** Score the next few; the screen calls again until `remaining` is 0 or the run halts. */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, aiScreenChunkSchema);
      if ("response" in body) return body.response;
      return ok(await screenChunk(actor, l, body.data.skip));
    }),
  ),
  { id: "hiring-ai-screen", limit: 60, windowMs: 60_000 },
);
