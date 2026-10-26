import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { directory } from "@/lib/hiring/people";
import { hiringRoute, parseQuery } from "@/lib/hiring/route";
import { requisitionSubject } from "@/lib/hiring/scope";
import { isPermission } from "@/lib/rbac/catalogue";

/** People picker (Interview Hub `/api/directory`): live users, optionally holders of a permission. */
const query = z.object({
  search: z.string().trim().max(100).optional(),
  permission: z.string().max(60).refine(isPermission).optional(),
  entityId: z.string().max(64).optional(),
  departmentId: z.string().max(64).optional(),
});

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.view")) return forbidden();
      const q = parseQuery(req, query);
      if ("response" in q) return q.response;
      const { search, permission, entityId, departmentId } = q.data;
      const subject = entityId
        ? await requisitionSubject({ entityId, departmentId: departmentId ?? null })
        : undefined;
      return ok(await directory({ search, permission: permission as never, subject }));
    }),
  ),
  { id: "hiring-directory", limit: 120, windowMs: 60_000 },
);
