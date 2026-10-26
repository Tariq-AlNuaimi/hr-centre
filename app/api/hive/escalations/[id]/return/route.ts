import type { NextRequest } from "next/server";
import { ok, err, readJsonBody } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { returnToDraft } from "@/lib/hive/services/escalation-queue";
import { returnToDraftSchema } from "@/lib/validations/hive/escalation-queue";

/**
 * An approver returns a submitted draft to its drafter with a note
 * (docs/blueprints/hive-ticketing.md AC-T2.2): PENDING_APPROVAL → IN_PROGRESS.
 * The gate (approve permission) is inside the service.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const parsed = returnToDraftSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid note.", 400);

  const result = await returnToDraft(id, ctx.session.user.id, parsed.data.note);
  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : 409;
    const message =
      result.error === "forbidden"
        ? "You cannot approve answers for this HR pair."
        : result.error === "not_found"
          ? "Not found."
          : "Only a ticket waiting for approval can be returned.";
    return err(message, status);
  }
  return ok(result);
});
