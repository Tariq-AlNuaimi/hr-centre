import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { retireTeam, updateTeam } from "@/lib/org/teams";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { updateTeamSchema } from "@/lib/validations/org";

/** Rename / move / retire one team (AC-F1.2, AC-F1.3). */

export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.configure) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateTeamSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return ok(await updateTeam(id, parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-teams-write", limit: 30, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.configure) return forbidden();

    try {
      await retireTeam(id);
      return ok({ id, retired: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-teams-write", limit: 30, windowMs: 60_000 },
);
