import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission, ticketReach } from "@/lib/hive/services/permissions";
import {
  createSavedReply,
  listSavedReplies,
  referenceSnippets,
} from "@/lib/hive/services/saved-replies";
import { savedRepliesQuerySchema, savedReplySchema } from "@/lib/validations/hive/escalation-queue";

/**
 * Saved replies (UX P1 tickets P1-4). GET: the replies for a pair (and the
 * shared ones) plus reference snippets — for anyone who may read tickets.
 * POST: Edit content only.
 */
export const GET = withRateLimit(
  withAuth(async (req: NextRequest, ctx) => {
    if (!(await ticketReach(ctx.session.user.id))) return forbidden();
    const parsed = savedRepliesQuerySchema.safeParse({
      pairId: req.nextUrl.searchParams.get("pairId") ?? undefined,
    });
    if (!parsed.success) return err("pairId is not valid.", 400);
    const [replies, snippets] = await Promise.all([
      listSavedReplies(parsed.data.pairId ?? null),
      referenceSnippets(),
    ]);
    return ok({ replies, snippets });
  }),
  { id: "hive-saved-replies-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    requireHivePermission("editContent", async (req, ctx) => {
      const parsed = savedReplySchema.safeParse(await readJsonBody(req));
      if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid reply.", 400);
      return created(await createSavedReply(parsed.data, ctx.session.user.id));
    }),
  ),
  { id: "hive-saved-replies-write", limit: 30, windowMs: 60_000 },
);
