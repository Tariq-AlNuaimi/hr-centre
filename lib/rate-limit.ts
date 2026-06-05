// In-memory token bucket rate limiter.
//
// Fine for the template's default single Vercel function instance; swap to @upstash/ratelimit
// when horizontally scaled. Horizontally-scaled downstream projects MUST swap to a shared-state
// limiter (e.g. @upstash/ratelimit backed by Redis or Upstash) -- per-instance buckets are
// bypassed by round-robin load balancing. See SECURITY.md finding T-01.

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

function clientIp(req: Request): string {
  // The trustworthy client IP depends on the proxy in front of the app, and the
  // LEFTMOST x-forwarded-for entry is client-spoofable: a client can inject its
  // own XFF header and the proxy appends the real IP *after* it, so XFF[0] can be
  // attacker-controlled. Precedence (most to least trusted):
  //   1. RATE_LIMIT_TRUSTED_IP_HEADER -- the deployment declares its proxy's
  //      real-client-IP header (e.g. "cf-connecting-ip" on Cloudflare,
  //      "x-real-ip" on Vercel/nginx). When set, trust ONLY that, which closes
  //      the spoofing gap for that topology.
  //   2. x-real-ip -- proxy-set, not part of the client-controlled XFF chain.
  //   3. x-forwarded-for[0] -- last-resort fallback (spoofable; see above).
  // NOTE: this limiter is still per-instance / in-memory (best-effort). Real
  // distributed enforcement is the @upstash/ratelimit scale-up (SECURITY.md T-01).
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trustedHeader) {
    const v = req.headers.get(trustedHeader);
    if (v) return v.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
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

  const key = `${opts.id}:${clientIp(req)}`;
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
