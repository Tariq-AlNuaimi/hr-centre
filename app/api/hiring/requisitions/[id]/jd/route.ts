import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { applyJdAction, jdView } from "@/lib/hiring/jd";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { jdActionSchema } from "@/lib/validations/hiring/requisition";

/** Step 3 — JD sign-off state / SUBMIT · SIGN · REQUEST_CHANGES. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      return ok(await jdView(actor, l));
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, jdActionSchema);
      if ("response" in body) return body.response;
      await applyJdAction(actor, l, body.data);
      return ok(await jdView(actor, (await loadRequisition(actor, id))!));
    }),
  ),
  { id: "hiring-jd-write", limit: 60, windowMs: 60_000 },
);
