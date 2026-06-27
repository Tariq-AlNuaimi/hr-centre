import { NextRequest } from "next/server";
import { Session } from "next-auth";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "./auth";
import { withAuditContext } from "./audit-context";
import { err, forbidden, ok } from "./api-response";
import { setUserContext } from "./sentry";
import { rateLimit, type RateLimitOptions } from "./rate-limit";
import { clientIp } from "./client-ip";
import { resolveToken, type ResolvedInvitation } from "./services/candidateRunner";

// Constant-time secret comparison for shared tokens (avoids a timing oracle on
// the secret). Length is allowed to leak (different-length inputs short-circuit);
// for a fixed-length secret that leaks nothing useful.
function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
    // are stored on audit_logs, never logged. Resolve the IP through the same
    // shared helper the rate limiter uses, so the throttled IP and the audited
    // IP are derived identically (and the spoofable-XFF hardening applies here
    // too). withAuditContext truncates both before they hit the DB.
    const ipAddress = clientIp(req) ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    return withAuditContext(
      { userId: session.user.id, orgId: session.user.orgId ?? null, ipAddress, userAgent },
      () => handler(req, { ...ctx, session })
    );
  };
}

/**
 * Like withAuth but also requires the HR_ADMIN role. Gates the admin-only
 * surfaces (role profiles, invites, calibration, settings, audit -- UI-SPEC
 * Part B / D).
 */
export function withAdminAuth(handler: AuthedHandler) {
  return withAuth(async (req, ctx) => {
    if (ctx.session.user.role !== "HR_ADMIN") return forbidden();
    return handler(req, ctx);
  });
}

/**
 * Like withAuth but requires a recognized staff role (HR_ADMIN or
 * HIRING_MANAGER). With only two roles today both pass, but routing writes
 * through this wrapper (rather than bare withAuth) keeps the role check
 * explicit and ready for a future read-only role. (SECURITY.md §3.)
 */
export function withManagerAuth(handler: AuthedHandler) {
  return withAuth(async (req, ctx) => {
    const role = ctx.session.user.role;
    if (role !== "HR_ADMIN" && role !== "HIRING_MANAGER") return forbidden();
    return handler(req, ctx);
  });
}

// Strict RFC-6750-style parse shared by withInternalAuth and withApiAuth:
// exact `Bearer ` prefix (case-sensitive), token trimmed. A bare
// `Authorization: <value>` or other schemes (Basic, Digest) yield null --
// never the raw header value.
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token || null;
}

type InternalAuthOptions = {
  /**
   * Also accept `Authorization: Bearer <secret>` for this route. OPT-IN per
   * route (default false) so the Bearer surface isn't silently widened on
   * every internal endpoint -- enable it only for callers that cannot send
   * custom headers (Vercel Cron injects `Bearer $CRON_SECRET`; ADR-018).
   * `x-internal-token`, when present, is authoritative: a wrong value is
   * never rescued by a correct Bearer header.
   */
  bearer?: boolean;
  /**
   * When the env var is unset, respond 200 `{ skipped: true }` instead of
   * 503. For scheduler-called routes where "not configured yet" is a healthy
   * no-op -- a daily Vercel Cron against an unconfigured fork should not log
   * a failed invocation every day (alarm fatigue). Default: 503.
   */
  skipWhenUnconfigured?: boolean;
};

/**
 * Gates an internal endpoint by a shared secret.
 *
 * The secret is the value of the env var named by `tokenEnv`, presented as
 * `x-internal-token: <secret>` (GitHub Actions / manual callers) or -- only
 * when `opts.bearer` is set -- `Authorization: Bearer <secret>` (ADR-018).
 * If the env var is unset, the endpoint returns 503 (or a 200 skip, see
 * `skipWhenUnconfigured`) -- this lets the template ship without every
 * secret configured.
 *
 * Used by `/api/internal/*` endpoints called from schedulers (Vercel Cron,
 * GitHub Actions workflows). These bypass session auth on purpose; the
 * calling scheduler holds the matching secret. Compose `withRateLimit`
 * outside this wrapper -- internal routes are reachable without a session,
 * so secret-guessing must be throttled.
 *
 * Audit attribution: there is no session, so writes performed inside the
 * handler attribute to `null` user in `audit_logs`. That is the correct
 * record -- the operator should query by `entityType` + time window.
 */
export function withInternalAuth(
  tokenEnv: string,
  handler: InternalHandler,
  opts: InternalAuthOptions = {}
) {
  return async (req: NextRequest, ctx: RouteContext) => {
    const expected = process.env[tokenEnv];
    if (!expected) {
      return opts.skipWhenUnconfigured
        ? ok({ skipped: true, reason: `${tokenEnv} is not set` })
        : err("Endpoint not configured", 503);
    }

    const provided =
      req.headers.get("x-internal-token") ?? (opts.bearer ? bearerToken(req) : null);
    if (!provided || !safeEqual(provided, expected)) return err("Unauthorized", 401);

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

    const token = bearerToken(req);
    if (!token || !safeEqual(token, expected)) return err("Unauthorized", 401);

    return handler(req, ctx);
  };
}

// The resolved, writable invitation handed to a candidate handler (active or
// already-completed; the handler enforces the per-status rules, e.g. response
// after submit → 409). Carries its assessment (may be null before consent).
type CandidateContext = RouteContext & {
  invitation: ResolvedInvitation;
};

type CandidateHandler = (
  req: NextRequest,
  ctx: CandidateContext
) => Promise<NextResponse>;

/**
 * Token-authorized candidate runner gate (ARCHITECTURE §12.4, UI-SPEC C.1). The
 * candidate has NO session: the opaque high-entropy `token` route param authorizes
 * the write. Resolves the token (UI-SPEC C.1 states), rejecting invalid (404),
 * revoked (403), and expired (410) uniformly; `active`/`completed` pass through so
 * the handler applies status rules. Stamps the audit context with the invitation's
 * orgId and a NULL user (the candidate is not a User). Compose `withRateLimit`
 * OUTSIDE this wrapper — the surface is public, so floods must be throttled before
 * the DB lookup runs.
 */
export function withCandidateToken(handler: CandidateHandler): RouteHandler {
  return async (req: NextRequest, ctx: RouteContext) => {
    const { token } = await ctx.params;
    const resolution = await resolveToken(token);

    switch (resolution.state) {
      case "invalid":
        return err("This assessment link is not valid", 404);
      case "revoked":
        return err("This assessment link has been revoked", 403);
      case "expired":
        return err("This assessment link has expired", 410);
      // "active" | "completed" carry an invitation; the handler decides.
    }

    const ipAddress = clientIp(req) ?? undefined;
    const userAgent = req.headers.get("user-agent") ?? undefined;

    // No session → no userId; the audit extension records a NULL actor (the
    // candidate is not a User). orgId comes from the resolved invitation.
    return withAuditContext(
      { userId: undefined, orgId: resolution.invitation.orgId, ipAddress, userAgent },
      () => handler(req, { ...ctx, invitation: resolution.invitation })
    );
  };
}
