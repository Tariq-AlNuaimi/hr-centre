import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { cancelOrgChange } from "@/lib/org/changes";
import { ruleErrorResponse } from "@/lib/org/http";

/** P2 (UX R19) — cancel a scheduled reorganisation step. Org managers only. */
export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();
    try {
      return ok(await cancelOrgChange(id));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-changes-write", limit: 30, windowMs: 60_000 },
);
