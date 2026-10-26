import { ok, err } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { approveAndSend, type ApproveOutcome } from "@/lib/hive/services/escalation-queue";

/**
 * §5.4 step 5–6: approve, and send automatically (AC-11.1, AC-11.2, AC-11.3,
 * AC-11.4).
 *
 * **The gate is inside `approveAndSend`, not in a wrapper here, and that is
 * deliberate.** AC-10.2 says a user without the `approve` permission (a non-ADMIN, ADR-072) gets a 403 "not merely
 * hidden", and AC-11.1 says there is no exception path. Putting the check in the
 * service means every caller of it is gated — including a future admin screen,
 * a script, or a second route — rather than only the one that happens to have
 * remembered the wrapper.
 *
 * §5.3's backup-approver note is why there is no directorate check anywhere in
 * this path: Siham approves "for any escalation, regardless of directorate",
 * so the only question is whether the person holds the permission.
 */
/** Each refusal's message and status, as data rather than a nested ternary. */
const REFUSALS: Record<Exclude<ApproveOutcome, { ok: boolean }>["error"], [string, number]> = {
  forbidden: ["You cannot approve answers for this HR pair.", 403],
  not_found: ["Not found.", 404],
  no_draft: ["Write an answer before approving it.", 422],
  closed: ["This conversation is closed.", 409],
  not_pending: ["Only a submitted answer, or one whose send failed, can be approved.", 409],
  sending: ["This answer is already being sent.", 409],
  already_sent: ["That answer has already been sent.", 409],
  self_approval: [
    "You wrote this draft, so someone else must approve it. It is waiting for another approver.",
    403,
  ],
};

export const POST = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const result = await approveAndSend(id, ctx.session.user.id);

  // Discriminated on `ok`, not on the presence of `error`: the SEND_FAILED
  // variant carries an `error` too, and an `"error" in result` guard swallows
  // it — which would report a failed send as a success.
  if (!("ok" in result)) {
    const [message, status] = REFUSALS[result.error];
    return err(message, status);
  }

  // AC-11.4: a failed send is reported as a failure, with the escalation left in
  // SEND_FAILED and back in the queue. A 200 here would tell HR the employee has
  // their answer.
  if (!result.ok) {
    return err(`The answer was approved but could not be sent: ${result.error}`, 502);
  }

  return ok(result);
});
