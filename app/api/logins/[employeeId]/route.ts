import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { actorCan, canViewEmployee } from "@/lib/pms/permissions";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { placementOf } from "@/lib/rbac/resolve";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { disableLogin, issueTemporaryPassword, loginSummary } from "@/lib/people/logins";
import { issueLoginSchema } from "@/lib/validations/login";

/**
 * Logins for one employee — blueprint §4 (F-d). Needs `logins.manage` for the
 * employee's scope; an employee outside the actor's view reads as absent (404,
 * no existence leak). Tightly rate-limited: these mint credentials.
 */

type Ctx = { params: Promise<Record<string, string>>; session: Parameters<typeof resolveActor>[0] };

type Authorised =
  | { ok: false; response: NextResponse }
  | { ok: true; employeeId: string; actor: Awaited<ReturnType<typeof resolveActor>> };

async function authorise(ctx: Ctx): Promise<Authorised> {
  const { employeeId } = await ctx.params;
  const actor = await resolveActor(ctx.session);
  const descendants = await visibilityDescendants(actor);
  if (!canViewEmployee(actor, employeeId, descendants))
    return { ok: false, response: notFound("Employee") };
  const subject = await placementOf(employeeId);
  if (!subject) return { ok: false, response: notFound("Employee") };
  if (!actorCan(actor, "logins.manage", subject)) return { ok: false, response: forbidden() };
  return { ok: true, employeeId, actor };
}

const LIMIT = { limit: 10, windowMs: 60_000 };

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const auth = await authorise(ctx);
    if (!auth.ok) return auth.response;
    try {
      return ok(await loginSummary(auth.employeeId));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "logins-read", limit: 60, windowMs: 60_000 },
);

/** Create or reset: the response carries the temporary password ONCE, never cached. */
export const POST = withRateLimit(
  withAuth(async (request: NextRequest, ctx) => {
    const auth = await authorise(ctx);
    if (!auth.ok) return auth.response;
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = issueLoginSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      const issued = await issueTemporaryPassword(auth.employeeId, parsed.data.action);
      const response = NextResponse.json({ data: issued }, { status: 200 });
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "logins-write", ...LIMIT },
);

export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, ctx) => {
    const auth = await authorise(ctx);
    if (!auth.ok) return auth.response;
    try {
      await disableLogin(auth.employeeId, auth.actor.userId);
      return ok({ disabled: true });
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "logins-write", ...LIMIT },
);
