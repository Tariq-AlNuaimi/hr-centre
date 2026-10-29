import type { NextResponse } from "next/server";

/**
 * P2-4 — response hygiene shared by the two public preboarding routes: never
 * cached, never indexed (the token ends up in history and, on some clients, a
 * Referer), and a per-token rate-limit key.
 */
export function withPrivateHeaders<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

/** A synthetic request keyed by the token, so the limiter counts per link, not per IP. */
export function tokenScopedRequest(token: string, scope: string): Request {
  const headers = new Headers();
  const trusted = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (trusted) headers.set(trusted, token);
  headers.set("x-real-ip", token);
  headers.set("x-forwarded-for", token);
  return new Request(`https://jml.internal/${scope}`, { headers });
}
