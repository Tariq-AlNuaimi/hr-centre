import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { parsePagination } from "@/lib/pagination";
import { createAssignmentRule, listAssignmentRules } from "@/lib/jml/engine/assignment";
import { body, jml, query, requireGroup } from "@/lib/jml/route";
import { ruleCreateSchema } from "@/lib/validations/jml/config";

const filterSchema = z.object({
  scope: z.enum(["COMPANY", "DIRECTORATE", "DEPARTMENT"]).optional(),
  active: z.enum(["true", "false"]).optional(),
  hrUserId: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

/** HR owner assignment rules (Onboarding §14 / BR-002, one model for all case types). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      const f = query(req, filterSchema);
      return ok(
        await listAssignmentRules(
          {
            scope: f.scope,
            active: f.active === undefined ? undefined : f.active === "true",
            hrUserId: f.hrUserId,
            entityId: f.entityId,
          },
          parsePagination(req.nextUrl.searchParams),
        ),
      );
    }),
  ),
  { id: "jml-rules-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(await createAssignmentRule(await body(req, ruleCreateSchema)));
    }),
  ),
  { id: "jml-rules-write", limit: 30, windowMs: 60_000 },
);
