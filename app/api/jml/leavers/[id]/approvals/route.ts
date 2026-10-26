import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { listApprovals, requestApproval } from "@/lib/jml/leave/approvals";
import { body, jml } from "@/lib/jml/route";
import { requestApprovalSchema } from "@/lib/validations/jml/leave";

/** The case's approvals with the termination / settlement checks. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listApprovals(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Request the missing holder rows of one approval type (idempotent). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(
        await requestApproval(
          actor,
          params.id!,
          (await body(req, requestApprovalSchema)).approvalType,
        ),
      ),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
