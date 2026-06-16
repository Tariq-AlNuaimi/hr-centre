// Best-effort client IP resolution, shared by the rate limiter (lib/rate-limit.ts)
// and request attribution for the audit log (lib/api-helpers.ts withAuth). Keeping
// a single implementation means the IP we throttle on and the IP we record in
// audit_logs are derived identically -- they can't silently diverge.
//
// The trustworthy client IP depends on the proxy in front of the app, and the
// LEFTMOST x-forwarded-for entry is client-spoofable: a client can inject its own
// XFF header and the proxy appends the real IP *after* it, so XFF[0] can be
// attacker-controlled. Precedence (most to least trusted):
//   1. RATE_LIMIT_TRUSTED_IP_HEADER -- the deployment declares its proxy's
//      real-client-IP header (e.g. "cf-connecting-ip" on Cloudflare, "x-real-ip"
//      on Vercel/nginx). When set, trust ONLY that, which closes the spoofing gap
//      for that topology.
//   2. x-real-ip -- proxy-set, not part of the client-controlled XFF chain.
//   3. x-forwarded-for[0] -- last-resort fallback (spoofable; see above).
//
// Returns null when no IP header is present; callers decide the fallback
// (rate-limit buckets on "unknown"; audit stores undefined).
export function clientIp(req: Request): string | null {
  const trustedHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trustedHeader) {
    const v = req.headers.get(trustedHeader);
    if (v) return v.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return null;
}
