import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadRequisition, requisitionDetail } from "@/lib/hiring/requisitions";
import { updateRequisition } from "@/lib/hiring/requisition-write";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { prisma } from "@/lib/prisma";
import { updateRequisitionSchema } from "@/lib/validations/hiring/requisition";

/** One requisition. Out of scope = 404 (no existence oracle). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      return ok(await requisitionDetail(actor, l));
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, updateRequisitionSchema);
      if ("response" in body) return body.response;
      await updateRequisition(actor, l.req, body.data);
      return ok({ id });
    }),
  ),
  { id: "hiring-requisitions-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id, "hiring.manage");
      if (!l) return notFound("Requisition");
      await prisma.hiringRequisition.delete({ where: { id } });
      return ok({ id, deleted: true });
    }),
  ),
  { id: "hiring-requisitions-write", limit: 60, windowMs: 60_000 },
);
