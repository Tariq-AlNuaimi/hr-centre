// In-memory token bucket rate limiter.
//
// Fine for the template's default single Vercel function instance; swap to @upstash/ratelimit
// when horizontally scaled. Horizontally-scaled downstream projects MUST swap to a shared-state
// limiter (e.g. @upstash/ratelimit backed by Redis or Upstash) -- per-instance buckets are
// bypassed by round-robin load balancing. See SECURITY.md finding T-01.

import { clientIp } from "./client-ip";

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

export function rateLimit(req: Request, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  // Bucket on the resolved client IP; unattributable requests share one bucket.
  const key = `${opts.id}:${clientIp(req) ?? "unknown"}`;
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
