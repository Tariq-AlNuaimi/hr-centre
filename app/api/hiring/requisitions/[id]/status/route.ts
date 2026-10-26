import type { HiringRequisitionStatus } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { can } from "@/lib/hiring/access";
import { HiringRuleError } from "@/lib/hiring/http";
import { assertRoutedToActor, changeRequisitionStatus } from "@/lib/hiring/requisition-status";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { statusChangeSchema } from "@/lib/validations/hiring/requisition";

/**
 * Status change with a mandatory note (ADR-024 in Interview Hub). Signing a
 * requisition step (PENDING_APPROVAL → OPEN) needs only the routed approval
 * role; every other move needs `hiring.manage`.
 */
export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadRequisition(actor, id);
      if (!l) return notFound("Requisition");
      const body = await parseBody(req, statusChangeSchema);
      if ("response" in body) return body.response;
      const to = body.data.status as HiringRequisitionStatus;
      const signing = l.req.status === "PENDING_APPROVAL" && to === "OPEN";
      const approverDecline =
        l.req.status === "PENDING_APPROVAL" &&
        to === "DRAFT" &&
        !can(actor, "hiring.manage", l.subject);
      if (!signing && !approverDecline && !can(actor, "hiring.manage", l.subject)) {
        throw new HiringRuleError("You can't change this requisition's status.", 403);
      }
      if (approverDecline) await assertRoutedToActor(actor, l.req, l.subject);
      return ok(await changeRequisitionStatus(actor, l.req, l.subject, to, body.data.reason));
    }),
  ),
  { id: "hiring-requisition-status", limit: 60, windowMs: 60_000 },
);
