import { NextRequest, NextResponse } from "next/server";
import { Session } from "next-auth";
import { auth } from "./auth";
import { withAuditContext } from "./audit-context";
import { err, forbidden } from "./api-response";

type RouteContext = { params: Promise<Record<string, string>> };

type AuthedHandler = (
  req: NextRequest,
  ctx: RouteContext & { session: Session }
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
    if ((ctx.session.user as any).role !== "ADMIN") return forbidden();
    return handler(req, ctx);
  });
}
