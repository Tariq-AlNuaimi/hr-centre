import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { decideApproval } from "@/lib/jml/leave/approvals";
import { body, jml } from "@/lib/jml/route";
import { decideApprovalSchema } from "@/lib/validations/jml/leave";

/** Record a holder's decision (jml.decideApprovals). */
export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(
        await decideApproval(
          actor,
          params.id!,
          params.approvalId!,
          await body(req, decideApprovalSchema),
        ),
      ),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
