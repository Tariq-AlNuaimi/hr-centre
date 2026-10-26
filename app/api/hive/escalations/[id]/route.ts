import type { NextRequest } from "next/server";
import { ok, err, readJsonBody } from "@/lib/api-response";
import { withAuth } from "@/lib/api-helpers";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import {
  draftAnswer,
  getEscalation,
  ticketAbilities,
  type DraftOutcome,
} from "@/lib/hive/services/escalation-queue";
import { draftAnswerSchema } from "@/lib/validations/hive/escalation-queue";
import { getTicketSettings } from "@/lib/hive/services/ticket-settings";

/**
 * One ticket. Same permission as the queue it came from (See tickets), plus
 * what THIS person may do on it — pair-scoped since ADR-073 — so the screen
 * shows only buttons the server will honour.
 */
export const GET = withAuth(
  requireHivePermission("seeTickets", async (_req, ctx) => {
    const { id } = await ctx.params;
    const row = await getEscalation(id);
    if (!row) return err("Not found.", 404);
    const [abilities, settings] = await Promise.all([
      ticketAbilities(ctx.session.user.id, {
        hrPairId: row.hrPair.id,
        draftedById: row.draftedBy?.id ?? null,
      }),
      getTicketSettings(),
    ]);
    return ok({ ...row, abilities, settings });
  }),
);

/** Each refusal's message and status. */
const DRAFT_REFUSALS: Record<Extract<DraftOutcome, { error: string }>["error"], [string, number]> =
  {
    not_found: ["Not found.", 404],
    forbidden: ["You cannot draft answers for this HR pair.", 403],
    closed: ["This conversation is closed.", 409],
    sending: ["This answer is being sent right now — wait a moment and reload.", 409],
    already_sent: ["That answer has already been sent.", 409],
  };

/**
 * Save a draft answer (§5.4 step 4).
 *
 * Drafting carries NO authority to send. §5.4 step 5 requires approval
 * "regardless of who drafted it", so this records who wrote it and nothing
 * more — the gate lives on the approve route, where it cannot be reached from
 * here. Saving moves the ticket to IN_PROGRESS, so an edit after submission
 * withdraws it from approval: an approver never approves text they did not see.
 */
export const PATCH = withAuth(
  requireHivePermission("draftEscalation", async (req: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const parsed = draftAnswerSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid answer.", 400);

    const result = await draftAnswer(id, parsed.data.draftAnswer, ctx.session.user.id);
    if ("error" in result) {
      const [message, status] = DRAFT_REFUSALS[result.error];
      return err(message, status);
    }
    return ok(result);
  }),
);
