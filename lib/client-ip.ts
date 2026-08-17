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
