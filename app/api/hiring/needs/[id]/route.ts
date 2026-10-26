import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { loadNeed, needThread, updateNeed } from "@/lib/hiring/planning";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { orgNames } from "@/lib/hiring/people";
import { updateNeedSchema } from "@/lib/validations/hiring/planning";

/** One department's requirement + its challenge thread (carried onto the hiring request). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const need = await loadNeed(actor, id, "hiring.view");
      if (!need) return notFound("Department need");
      const org = await orgNames([need.round.entityId], [need.departmentId]);
      return ok({
        id: need.id,
        status: need.status,
        rolesRequested: need.rolesRequested,
        agreedRoles: need.agreedRoles,
        departmentId: need.departmentId,
        department: org.departments.get(need.departmentId) ?? null,
        entityId: need.round.entityId,
        roundLabel: need.round.label,
        roundStatus: need.round.status,
        notes: await needThread(need),
      });
    }),
  ),
  { id: "hiring-planning-read", limit: 240, windowMs: 60_000 },
);

export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const need = await loadNeed(actor, id, "hiring.manage");
      if (!need) return notFound("Department need");
      const body = await parseBody(req, updateNeedSchema);
      if ("response" in body) return body.response;
      return ok(await updateNeed(need, body.data));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
