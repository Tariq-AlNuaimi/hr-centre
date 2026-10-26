import { ok, err } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { submitForApproval } from "@/lib/hive/services/escalation-queue";

/**
 * Submit the saved draft for approval (spec V2 §5.4 step 5, §8.8 "Submit for
 * approval"): IN_PROGRESS → PENDING_APPROVAL.
 *
 * The gate is inside the service, like approve and close beside it, so every
 * caller is gated by construction rather than by remembering a wrapper.
 */
export const POST = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const result = await submitForApproval(id, ctx.session.user.id);
  if ("error" in result) {
    const status =
      result.error === "forbidden"
        ? 403
        : result.error === "not_found"
          ? 404
          : result.error === "no_draft" || result.error === "unchanged"
            ? 422
            : 409;
    const message =
      result.error === "forbidden"
        ? "You cannot draft answers for this HR pair."
        : result.error === "not_found"
          ? "Not found."
          : result.error === "no_draft"
            ? "Save an answer before submitting it."
            : result.error === "unchanged"
              ? "This is the answer already sent. Edit it before submitting again."
              : "Only a ticket that is in progress can be submitted for approval.";
    return err(message, status);
  }
  return ok(result);
});
