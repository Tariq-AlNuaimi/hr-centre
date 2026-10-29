// Rate limiter with two backends:
//   - Valkey + rate-limiter-flexible (shared state) when VALKEY_URL/REDIS_URL is
//     set -- correct across multiple app replicas behind a load balancer.
//   - In-memory token bucket otherwise -- the single-container default.
//
// The in-memory bucket is per-instance, so under >1 replica the real limit
// becomes N x configured (round-robin bypass). That was a latent correctness bug
// (SECURITY.md finding T-01, ADR-035): a distributed deployment MUST set
// VALKEY_URL so the quota is shared. rateLimit() is async because the shared-state
// check is a network round-trip; the in-memory path resolves synchronously.

import { RateLimiterRedis, RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import { getValkey } from "./valkey";
import { NextResponse } from "next/server";
import { throttleKey } from "./client-ip";

export interface RateLimitOptions {
  /** Stable bucket name; included in the key so /api/auth and /api/foo have separate quotas. */
  id: string;
  /** Max requests permitted within `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Optional per-ACCOUNT bucket, consumed IN ADDITION to the per-IP one (both
   * must pass). The IP key is only as good as the header it derives from, and on
   * a deployment with no trusted proxy header that header is client-supplied --
   * an attacker rotating it gets a fresh IP bucket every request. A subject key
   * (an email, a user id) survives that rotation, so it is the control that
   * actually caps credential-stuffing and reset-spam against one account.
   *
   * The tradeoff is a targeted lockout: anyone who knows the address can burn
   * that account's bucket. Bounded by `windowMs`, so keep the window short and
   * use it where distributed abuse of ONE account is the threat you care about.
   */
  subject?: string;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the bucket resets. Pass through as the Retry-After header on 429. */
  retryAfter: number;
}

// --- in-memory backend (default; single-container) -------------------------

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

// Bound memory by sweeping stale entries at most once a minute.
let lastCleanup = Date.now();
function maybeCleanup(now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

function rateLimitInMemory(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfter: 0 };
  }

  entry.count += 1;
  if (entry.count > opts.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return {
    ok: true,
    remaining: opts.limit - entry.count,
    retryAfter: 0,
  };
}

// --- Valkey backend (shared-state; multi-replica) --------------------------

// One limiter per (id, limit, windowMs) so distinct quotas don't collide. Cached
// because constructing the limiter is cheap but repeated construction is wasteful.
const valkeyLimiters = new Map<string, RateLimiterRedis>();

function getValkeyLimiter(opts: RateLimitOptions): RateLimiterRedis | null {
  const store = getValkey();
  if (!store) return null;
  const cacheKey = `${opts.id}:${opts.limit}:${opts.windowMs}`;
  let limiter = valkeyLimiters.get(cacheKey);
  if (!limiter) {
    const duration = Math.max(1, Math.ceil(opts.windowMs / 1000));
    limiter = new RateLimiterRedis({
      storeClient: store,
      keyPrefix: `rl:${opts.id}`,
      points: opts.limit,
      duration,
      // If Valkey is unreachable, degrade to per-instance memory limiting
      // (fail-SAFE: still throttles, just not shared) instead of failing open.
      insuranceLimiter: new RateLimiterMemory({ points: opts.limit, duration }),
    });
    valkeyLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Consume one unit of the per-IP, per-`id` quota. Uses the shared Valkey backend
 * when configured (correct across replicas), else the in-memory bucket. Never
 * throws: an unexpected backend error fails safe to the in-memory decision.
 */
export async function rateLimit(req: Request, opts: RateLimitOptions): Promise<RateLimitResult> {
  // Bucket on the throttle key, NOT on clientIp(). clientIp is the attribution
  // source and returns null on an unconfigured deployment, which collapsed every
  // caller into one shared "unknown" bucket -- a global auth outage triggerable by
  // any stranger (review round 8). throttleKey always partitions; see client-ip.ts.
  const ipResult = await consume(`${opts.id}:${throttleKey(req)}`, opts);
  if (!opts.subject) return ipResult;

  // Per-account bucket. Consumed even when the IP bucket already said no, so the
  // two stay in step: skipping it would let an attacker spread a stuffing run over
  // rotated IP keys and never touch the account's own quota.
  const subjectResult = await consume(
    `${opts.id}:subject:${opts.subject.trim().toLowerCase()}`,
    opts,
  );
  if (ipResult.ok && subjectResult.ok) return ipResult;
  // Report the LATER reset, not whichever bucket was checked first. Taking the IP
  // bucket's `retryAfter` whenever both denied under-reported: a caller who waited
  // exactly that long was still refused by the subject bucket, so the Retry-After
  // header sent them back into a second 429 (senior review, uncertain-item U3,
  // 2026-08-21). Both buckets share `windowMs`, but not their start times -- the
  // subject bucket accumulates across IPs, so the two desync in exactly the case the
  // subject bucket exists for.
  const denied = !ipResult.ok ? ipResult : subjectResult;
  return {
    ...denied,
    remaining: Math.min(ipResult.remaining, subjectResult.remaining),
    retryAfter: Math.max(ipResult.retryAfter, subjectResult.retryAfter),
  };
}

/** Consume one unit from a single fully-qualified bucket key. */
async function consume(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const limiter = getValkeyLimiter(opts);
  if (!limiter) return rateLimitInMemory(key, opts);

  try {
    const res = await limiter.consume(key, 1);
    return { ok: true, remaining: res.remainingPoints, retryAfter: 0 };
  } catch (e) {
    // rate-limiter-flexible rejects with a RateLimiterRes when the limit is hit.
    if (e && typeof e === "object" && "msBeforeNext" in e) {
      const res = e as RateLimiterRes;
      return {
        ok: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil(res.msBeforeNext / 1000)),
      };
    }
    // Genuine backend failure the insuranceLimiter didn't absorb: fail safe to
    // the in-memory limiter rather than letting the request through unthrottled.
    return rateLimitInMemory(key, opts);
  }
}

// --- per-account buckets + the sign-in/password policy (ADR-100) -----------

/**
 * Consume one unit of a per-SUBJECT bucket only (no IP bucket). For limits whose
 * account quota differs from the IP quota -- `rateLimit({ subject })` consumes
 * both buckets at one shared limit, which cannot express "120/min per IP but
 * 10/min per account". The subject is normalised (trim + lowercase) exactly as
 * `rateLimit` does, so both entry points land in the same bucket for one id.
 */
export async function rateLimitSubject(
  subject: string,
  opts: Omit<RateLimitOptions, "subject">,
): Promise<RateLimitResult> {
  return consume(`${opts.id}:subject:${subject.trim().toLowerCase()}`, opts);
}

/**
 * Merge two bucket decisions: allowed only when both allow; on a refusal report
 * the LATER reset so a client that honours Retry-After is not refused again.
 */
function combine(a: RateLimitResult, b: RateLimitResult): RateLimitResult {
  if (a.ok && b.ok)
    return { ok: true, remaining: Math.min(a.remaining, b.remaining), retryAfter: 0 };
  return {
    ok: false,
    remaining: 0,
    retryAfter: Math.max(a.retryAfter, b.retryAfter, 1),
  };
}

const MINUTE = 60_000;

/**
 * The sign-in and password throttles, in one place so the routes, the contract
 * tests and SECURITY.md cite the same numbers (ADR-100). IP buckets are wide
 * enough for an office behind one NAT address; the per-account buckets are the
 * control that survives a rotating client IP. `lib/account-lockout.ts` (5 bad
 * passwords / 15 min) still runs underneath the login and password-change limits.
 *
 * Every bucket here is in-memory PER INSTANCE unless VALKEY_URL/REDIS_URL is set
 * (ADR-035), so across several Vercel instances the effective ceiling is
 * approximate (up to N x configured).
 */
export const AUTH_LIMITS = {
  /** Any POST to /api/auth/* (credentials sign-in, sign-out, ...), per IP. */
  loginIp: { id: "auth", limit: 120, windowMs: MINUTE },
  /** Credentials sign-in, per normalised email. */
  loginAccount: { id: "auth-login", limit: 10, windowMs: MINUTE },
  /** Password change (settings + forced first-login), per IP backstop. */
  passwordChangeIp: { id: "password-change", limit: 60, windowMs: MINUTE },
  /** Password change, per signed-in user -- shared by both change routes. */
  passwordChangeUser: { id: "password-change-user", limit: 5, windowMs: MINUTE },
  /** Forgot password (request a reset link), per IP. */
  resetRequestIp: { id: "auth-reset", limit: 30, windowMs: MINUTE },
  /** Forgot password, per normalised email. */
  resetRequestAccount: { id: "auth-reset", limit: 3, windowMs: 15 * MINUTE },
  /** Reset password (complete with the emailed token), per IP. */
  resetCompleteIp: { id: "auth-reset-complete", limit: 30, windowMs: MINUTE },
  /** Reset password, per account the token belongs to. */
  resetCompleteAccount: { id: "auth-reset-complete", limit: 3, windowMs: 15 * MINUTE },
} as const satisfies Record<string, Omit<RateLimitOptions, "subject">>;

/** Bodies larger than this are not parsed for an email (sign-in forms are tiny). */
const MAX_LOGIN_BODY = 8 * 1024;

/**
 * The email a credentials sign-in POST names, or null. Auth.js's client posts
 * `application/x-www-form-urlencoded` to `/api/auth/callback/credentials`; JSON
 * is accepted too. Reads a CLONE so the handler still gets the body.
 */
export async function loginEmailFrom(req: Request): Promise<string | null> {
  if (!new URL(req.url).pathname.endsWith("/callback/credentials")) return null;
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_LOGIN_BODY) return null;
  let text: string;
  try {
    text = await req.clone().text();
  } catch {
    return null;
  }
  if (text.length > MAX_LOGIN_BODY) return null;
  let email: unknown = null;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      email = (JSON.parse(text) as { email?: unknown } | null)?.email ?? null;
    } catch {
      return null;
    }
  } else {
    email = new URLSearchParams(text).get("email");
  }
  if (typeof email !== "string") return null;
  const normalised = email.trim().toLowerCase();
  return normalised.length > 0 && normalised.length <= 320 ? normalised : null;
}

/** Login throttle: per IP on every POST, plus per account on a credentials sign-in. */
export async function throttleLogin(req: Request): Promise<RateLimitResult> {
  const ip = await rateLimit(req, AUTH_LIMITS.loginIp);
  const email = await loginEmailFrom(req);
  if (!email) return ip;
  // Consumed even when the IP bucket refused, so a run spread across rotated IP
  // keys still drains the account's own quota (same reasoning as rateLimit()).
  return combine(ip, await rateLimitSubject(email, AUTH_LIMITS.loginAccount));
}

/** Password-change per-user throttle (the per-IP backstop is `withRateLimit`). */
export function throttlePasswordChange(userId: string): Promise<RateLimitResult> {
  return rateLimitSubject(userId, AUTH_LIMITS.passwordChangeUser);
}

/** Forgot-password throttle: per IP, plus per address when one parsed. */
export async function throttleResetRequest(
  req: Request,
  email: string | null,
): Promise<RateLimitResult> {
  const ip = await rateLimit(req, AUTH_LIMITS.resetRequestIp);
  if (!email) return ip;
  return combine(ip, await rateLimitSubject(email, AUTH_LIMITS.resetRequestAccount));
}

/** Reset-complete per-account throttle (the token's owner), after the IP bucket. */
export function throttleResetComplete(email: string): Promise<RateLimitResult> {
  return rateLimitSubject(email, AUTH_LIMITS.resetCompleteAccount);
}

/** The 429 every throttle returns, with Retry-After. */
export function tooManyRequests(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "retry-after": String(result.retryAfter) } },
  );
}
