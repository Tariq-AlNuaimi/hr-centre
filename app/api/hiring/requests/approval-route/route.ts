import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { can } from "@/lib/hiring/access";
import { getRoutedChain } from "@/lib/hiring/approval-config";
import { CURRENCY_CODES, toOMR } from "@/lib/hiring/money";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { requisitionSubject } from "@/lib/hiring/scope";
import { prisma } from "@/lib/prisma";

/** Preview of who will approve a request for this company (named approvers). */
const query = z.object({
  entityId: z.string().min(1).max(64),
  departmentId: z.string().max(64).optional(),
  bandMax: z.coerce.number().nonnegative().max(1_000_000).optional(),
  currency: z.enum(CURRENCY_CODES).default("OMR"),
});

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, query);
      if ("response" in q) return q.response;
      const subject = await requisitionSubject({
        entityId: q.data.entityId,
        departmentId: q.data.departmentId ?? null,
      });
      if (!can(actor, "hiring.manage", subject)) return notFound("Company");
      const entity = await prisma.orgEntity.findUnique({
        where: { id: q.data.entityId },
        select: { code: true },
      });
      if (!entity) return notFound("Company");
      const band = q.data.bandMax === undefined ? null : toOMR(q.data.bandMax, q.data.currency);
      return ok(await getRoutedChain(entity.code, subject, band, "requisition"));
    }),
  ),
  { id: "hiring-requisition-read", limit: 240, windowMs: 60_000 },
);
