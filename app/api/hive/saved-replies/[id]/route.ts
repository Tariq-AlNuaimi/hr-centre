import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { deleteSavedReply, updateSavedReply } from "@/lib/hive/services/saved-replies";
import { savedReplySchema } from "@/lib/validations/hive/escalation-queue";

/** Edit or delete one saved reply (UX P1 tickets P1-4) — Edit content only. */
export const PUT = withRateLimit(
  withAuth(
    requireHivePermission("editContent", async (req, ctx) => {
      // authz-ok: saved replies are shared reference text, governed by the group-wide Edit content permission checked above
      const { id } = await ctx.params;
      const parsed = savedReplySchema.safeParse(await readJsonBody(req));
      if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid reply.", 400);
      const updated = await updateSavedReply(id, parsed.data);
      return updated ? ok(updated) : err("Not found.", 404);
    }),
  ),
  { id: "hive-saved-replies-write", limit: 30, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    requireHivePermission("editContent", async (_req, ctx) => {
      // authz-ok: saved replies are shared reference text, governed by the group-wide Edit content permission checked above
      const { id } = await ctx.params;
      return (await deleteSavedReply(id)) ? ok({ id }) : err("Not found.", 404);
    }),
  ),
  { id: "hive-saved-replies-write", limit: 30, windowMs: 60_000 },
);
