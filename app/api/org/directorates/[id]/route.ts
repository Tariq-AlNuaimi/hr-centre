import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { renameDirectorate, retireDirectorate } from "@/lib/org/units";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { updateDirectorateSchema } from "@/lib/validations/org";

/** Rename / retire one directorate. A directorate never changes company. */

export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateDirectorateSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return ok(await renameDirectorate(id, parsed.data.name));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-directorates-write", limit: 30, windowMs: 60_000 },
);

/** Retire (soft delete). Refused while departments remain under it (AC-F1.3). */
export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    try {
      await retireDirectorate(id);
      return ok({ id, retired: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-directorates-write", limit: 30, windowMs: 60_000 },
);
