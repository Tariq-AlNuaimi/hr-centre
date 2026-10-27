import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { assignEscalation, pairPeople } from "@/lib/hive/services/ticket-assign";
import { canOnPair } from "@/lib/hive/services/permissions";
import { prisma } from "@/lib/prisma";
import { assigneeSchema } from "@/lib/validations/hive/escalation-queue";

/**
 * Who answers this ticket (UX P1 tickets P1-2). GET: the pair's drafters and
 * approvers by name (for the picker and the "who approves" line) — for anyone
 * who may draft on the pair. PUT: assign or unassign; both people must be able
 * to draft for the pair (checked in the service).
 */
export const GET = withRateLimit(
  withAuth(async (_req: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const row = await prisma.escalation.findUnique({ where: { id }, select: { hrPairId: true } });
    if (!row) return err("Not found.", 404);
    if (!(await canOnPair(ctx.session.user.id, "draftEscalation", row.hrPairId))) {
      return err("You cannot assign tickets for this HR pair.", 403);
    }
    return ok(await pairPeople(row.hrPairId));
  }),
  { id: "hive-assignee-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(async (req: NextRequest, ctx) => {
    const parsed = assigneeSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return err("assigneeId must be a user id or null.", 400);
    const { id } = await ctx.params;
    const result = await assignEscalation(id, ctx.session.user.id, parsed.data.assigneeId);
    if ("error" in result) {
      if (result.error === "not_found") return err("Not found.", 404);
      if (result.error === "forbidden")
        return err("You cannot assign tickets for this HR pair.", 403);
      return err("That person cannot draft answers for this HR pair.", 422);
    }
    return ok(result);
  }),
  { id: "hive-assignee-write", limit: 60, windowMs: 60_000 },
);
