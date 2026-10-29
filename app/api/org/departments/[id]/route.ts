import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { retireOrgDepartment, updateOrgDepartment } from "@/lib/org/units";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { updateOrgDepartmentSchema } from "@/lib/validations/org";

/**
 * Rename / move / retire one department (blueprint §1, AC-F1.1, AC-F1.3).
 * Moving to another company is refused while it has people.
 */

export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateOrgDepartmentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return ok(await updateOrgDepartment(id, parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "pms-departments-write", limit: 30, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    try {
      await retireOrgDepartment(id);
      return ok({ id, retired: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "pms-departments-write", limit: 30, windowMs: 60_000 },
);
