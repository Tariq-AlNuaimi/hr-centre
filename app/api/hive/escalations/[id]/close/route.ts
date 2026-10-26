import { ok, err } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { closeEscalation } from "@/lib/hive/services/escalation-queue";

/**
 * Close an escalation, revoking its reply links (ADR-070 clause 4).
 *
 * The gate lives in the SERVICE, like `approve` beside it and for the same
 * reason: every caller is gated by construction rather than by remembering a
 * wrapper. Closing takes the `approve` permission (ADMIN, ADR-072) — it is the decision that the exchange is
 * over, which is the same authority that decided the answer was right — or
 * drafting rights once the answer has been sent (spec V2 §5.4 step 7).
 */
export const POST = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const result = await closeEscalation(id, ctx.session.user.id);
  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : 409;
    const message =
      result.error === "forbidden"
        ? "You cannot close tickets for this HR pair at this stage."
        : result.error === "not_found"
          ? "Not found."
          : result.error === "sending"
            ? "This answer is being sent right now. Close the ticket once it has gone."
            : "This ticket is already closed.";
    return err(message, status);
  }
  return ok(result);
});
