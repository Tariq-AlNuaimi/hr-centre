import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { listOrgChanges, scheduleOrgChange } from "@/lib/org/changes";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { scheduleOrgChangeSchema } from "@/lib/validations/org";

/**
 * P2 (UX R19) — effective-dated reorganisation. GET lists scheduled changes and
 * the history; POST schedules one (a change dated today or earlier applies at
 * once). Org managers only, like every other org-structure write.
 */

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();
    return ok(await listOrgChanges());
  }),
  { id: "org-changes-read", limit: 60, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = scheduleOrgChangeSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return created(await scheduleOrgChange(parsed.data, actor.userId));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-changes-write", limit: 30, windowMs: 60_000 },
);
