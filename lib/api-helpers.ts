import { NextRequest } from "next/server";
import { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { withAuditContext } from "./audit-context";
import { err, forbidden } from "./api-response";
import { setUserContext } from "./sentry";
import { rateLimit, type RateLimitOptions } from "./rate-limit";

type RouteContext = { params: Promise<Record<string, string>> };

type AuthedHandler = (
  req: NextRequest,
  ctx: RouteContext & { session: Session }
) => Promise<NextResponse>;

type InternalHandler = (
  req: NextRequest,
  ctx: RouteContext
) => Promise<NextResponse>;

// A fully-wrapped route handler (the shape withAuth/withAdminAuth return).
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;

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

    // Capture request attribution so the audit extension records who + from
    // where. ipAddress / userAgent are Confidential (see SECURITY.md §1); they
    // are stored on audit_logs, never logged.
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    return withAuditContext({ userId: session.user.id, ipAddress, userAgent }, () =>
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

/**
 * Per-route rate limiting. Compose OUTSIDE the auth wrapper so abusive clients
 * are throttled before auth work runs:
 *   export const POST = withRateLimit(withAdminAuth(handler), { id: "x-write", limit: 30, windowMs: 60_000 });
 * Returns 429 + Retry-After when the per-IP bucket is exceeded. NOTE: the bucket
 * is in-memory/per-instance (see lib/rate-limit.ts) -- swap to @upstash/ratelimit
 * for multi-instance deployments.
 */
export function withRateLimit(handler: RouteHandler, opts: RateLimitOptions): RouteHandler {
  return async (req, ctx) => {
    const result = rateLimit(req, opts);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "retry-after": String(result.retryAfter) } }
      );
    }
    return handler(req, ctx);
  };
}

/**
 * SSO/handoff SEAM: gates a route for external/machine API consumers via a
 * Bearer token (`Authorization: Bearer <token>`) matched against the env var
 * named by `tokenEnv`. Returns 503 if unset, 401 on missing/bad token.
 *
 * This is the minimal seam so the template is "API-ready" without bloat. The
 * full per-consumer model (a hashed, scoped `ApiKey` table + `/api/v1` + OpenAPI)
 * is a `shared`-tier `/scale-up` recipe -- see ADR-013. Until then, set a single
 * shared key in the env var to expose a route to a trusted caller.
 */
export function withApiAuth(tokenEnv: string, handler: InternalHandler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const expected = process.env[tokenEnv];
    if (!expected) return err("Endpoint not configured", 503);

    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token !== expected) return err("Unauthorized", 401);

    return handler(req, ctx);
  };
}
