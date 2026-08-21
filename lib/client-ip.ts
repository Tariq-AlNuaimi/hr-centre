// Best-effort client IP resolution, shared by the rate limiter (lib/rate-limit.ts)
// and request attribution for the audit log (lib/api-helpers.ts withAuth). Keeping
// a single implementation means the IP we throttle on and the IP we record in
// audit_logs are derived identically -- they can't silently diverge.
//
// FAIL-CLOSED on untrusted headers (2026-08-17 red-team R1). EVERY forwarding
// header is client-spoofable unless a proxy in front of the app overwrites it:
//   - `x-forwarded-for` is append-only, so XFF[0] is attacker-controlled;
//   - `x-real-ip` is NOT set by every proxy. Caddy's `reverse_proxy` sets the
//     X-Forwarded-* family but NOT X-Real-IP, and passes a client-supplied one
//     through untouched -- so the template's own self-host rail (Caddyfile,
//     ADR-035) forwarded whatever the client sent.
// Trusting it by default meant an attacker could rotate `X-Real-IP` per request
// to land every request in a fresh rate-limit bucket (defeating the login and
// password-reset throttles) AND write an arbitrary value into
// `audit_logs.ipAddress`, forging the forensic record.
//
// So: a forwarding header is trusted ONLY when the deployment explicitly names
// the one its proxy guarantees, via RATE_LIMIT_TRUSTED_IP_HEADER (e.g.
// "cf-connecting-ip" on Cloudflare, "x-real-ip" behind Vercel or a Caddy/nginx
// that sets it -- see the Caddyfile, which now strips and re-sets it).
//
// With nothing configured we return null rather than guessing. Callers degrade
// safely: the rate limiter buckets on "unknown" (shared, i.e. STRICTER, never
// bypassable) and the audit log stores undefined (honestly absent, never forged).
// An unconfigured deployment therefore throttles harder, not weaker -- the
// correct direction to fail.
//
// Set RATE_LIMIT_TRUSTED_IP_HEADER in any deployment that sits behind a proxy
// you control; see .env.example and SECURITY.md.
export function clientIp(req: Request): string | null {
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (!trustedHeader) return null;

  const value = req.headers.get(trustedHeader);
  if (!value) return null;

  // Take the leftmost entry: for a single-value header (cf-connecting-ip,
  // x-real-ip) that IS the value; for a proxy-controlled XFF-style chain the
  // leftmost is the origin client. Safe here precisely because the operator has
  // declared this header trustworthy for their topology.
  const first = value.split(",")[0].trim();
  return first || null;
}

// --- THROTTLING side (review round 8) --------------------------------------
//
// `clientIp` above is the ATTRIBUTION source and must stay strict: a forged
// `audit_logs.ipAddress` is worse than an absent one, so it returns null unless
// the operator has named a header their proxy guarantees.
//
// Throttling has the OPPOSITE failure asymmetry, and the first cut got it wrong.
// `rateLimit` keyed on `clientIp(req) ?? "unknown"`, so on an unconfigured
// deployment EVERY request in the process shared one bucket per id -- and the
// auth buckets are small (login 10/min, reset 5/min). Eleven login attempts from
// anyone, anywhere, locked every user out of signing in for the rest of the
// minute. That is a one-liner denial of service against the whole app, handed to
// an unauthenticated stranger, and `VALKEY_URL` made it worse by sharing the
// single bucket across all replicas instead of just one. The header spoofing the
// strict mode was defending against is a smaller harm than the collateral outage
// the defense caused.
//
// So the throttle key never collapses. In descending order of trust:
//   1. RATE_LIMIT_TRUSTED_IP_HEADER -- operator-declared, trusted.
//   2. Platform-set headers when running on a platform that overwrites them
//      (Vercel sets `x-real-ip` from the real peer on every request and does not
//      pass an inbound one through), so the common deployment needs no config.
//   3. Otherwise, the client-supplied header, marked `untrusted:`. An attacker
//      who rotates it evades their OWN throttle -- which is exactly where they
//      started, with no throttle -- but they can no longer drag everyone else
//      into their bucket. Evasion by one is strictly better than an outage for
//      all. Per-account limits are the control that survives header rotation:
//      pass `subject` to rateLimit (see lib/rate-limit.ts).
//   4. No headers at all (direct connection, e.g. local dev): one shared bucket.
//      Nothing else is knowable, and this is not an internet-facing shape.
const PLATFORM_HEADER = process.env.VERCEL ? "x-real-ip" : null;

export function throttleKey(req: Request): string {
  const trusted = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trusted) {
    const v = firstEntry(req.headers.get(trusted));
    if (v) return `ip:${v}`;
  }
  if (PLATFORM_HEADER) {
    const v = firstEntry(req.headers.get(PLATFORM_HEADER));
    if (v) return `ip:${v}`;
  }
  const claimed =
    firstEntry(req.headers.get("x-real-ip")) ?? firstEntry(req.headers.get("x-forwarded-for"));
  // Prefixed so a spoofed value can never collide with a trusted one: an attacker
  // sending `X-Real-IP: <victim>` lands in `untrusted:<victim>`, not the victim's
  // `ip:<victim>` bucket, so they cannot exhaust someone else's quota either.
  if (claimed) return `untrusted:${claimed}`;
  return "unattributed";
}

function firstEntry(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0].trim();
  return first || null;
}

/**
 * True when neither an operator-declared nor a platform-guaranteed IP header is
 * available, i.e. throttling is running on client-supplied values and per-IP
 * limits are evadable. Surfaced by the health route and warned about at startup
 * so this degrades LOUDLY instead of silently.
 */
export function ipTrustIsConfigured(): boolean {
  return Boolean(process.env.RATE_LIMIT_TRUSTED_IP_HEADER || PLATFORM_HEADER);
}
