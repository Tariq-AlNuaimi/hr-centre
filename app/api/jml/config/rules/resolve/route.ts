import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { resolveHrAssignment } from "@/lib/jml/engine/assignment";
import { jml, query, requireGroup } from "@/lib/jml/route";
import { resolveRuleSchema } from "@/lib/validations/jml/config";

/** "Who would own a case here?" — the rule screen's preview (matched level, candidates). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      const q = query(req, resolveRuleSchema);
      return ok(await resolveHrAssignment(q, q.caseType));
    }),
  ),
  { id: "jml-rules-read", limit: 120, windowMs: 60_000 },
);
