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
import { clientIp } from "./client-ip";

export interface RateLimitOptions {
  /** Stable bucket name; included in the key so /api/auth and /api/foo have separate quotas. */
  id: string;
  /** Max requests permitted within `windowMs`. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
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
  // Bucket on the resolved client IP; unattributable requests share one bucket.
  const key = `${opts.id}:${clientIp(req) ?? "unknown"}`;

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
