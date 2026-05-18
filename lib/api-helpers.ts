import { NextRequest } from "next/server";
import { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { withAuditContext } from "./audit-context";
import { err, forbidden } from "./api-response";
import { setUserContext } from "./sentry";

type RouteContext = { params: Promise<Record<string, string>> };

type AuthedHandler = (
  req: NextRequest,
  ctx: RouteContext & { session: Session }
) => Promise<NextResponse>;

type InternalHandler = (
  req: NextRequest,
  ctx: RouteContext
) => Promise<NextResponse>;

/**
 * Wraps an API route handler with authentication + audit context.
 * Rejects with 401 if no session. Automatically sets audit context
 * so all Prisma writes within the handler are attributed to the user.
 */
export function withAuth(handler: AuthedHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const session = await auth();
    if (!session) return err("Unauthorized", 401);

    // Tag the Sentry scope with the user id (no PII -- see lib/sentry.ts).
    // No-op if Sentry isn't configured.
    setUserContext(session.user.id);

    return withAuditContext({ userId: session.user.id }, () =>
      handler(req, { ...ctx, session })
    );
  };
}

/**
 * Like withAuth but also requires ADMIN role.
 */
export function withAdminAuth(handler: AuthedHandler) {
  return withAuth(async (req, ctx) => {
    if (ctx.session.user.role !== "ADMIN") return forbidden();
    return handler(req, ctx);
  });
}

/**
 * Gates an internal endpoint by a shared-secret header.
 *
 * The header `x-internal-token` must match the value of the env var named by
 * `tokenEnv`. If the env var is unset, the endpoint returns 503 -- this lets
 * the template ship without every secret configured.
 *
 * Used by `/api/internal/*` endpoints called from scheduled GitHub Actions
 * workflows (audit retention, etc.). These bypass session auth on purpose;
 * the calling workflow holds the matching secret.
 *
 * Audit attribution: there is no session, so writes performed inside the
 * handler attribute to `null` user in `audit_logs`. That is the correct
 * record -- the operator should query by `entityType` + time window.
 */
export function withInternalAuth(tokenEnv: string, handler: InternalHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const expected = process.env[tokenEnv];
    if (!expected) return err("Endpoint not configured", 503);

    const provided = req.headers.get("x-internal-token");
    if (!provided || provided !== expected) return err("Unauthorized", 401);

    return handler(req, ctx);
  };
}
