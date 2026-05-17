import { handlers } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const GET = handlers.GET;

// Brute-force defense for credentials login (and any other POST to /api/auth/*).
// 10 requests / minute / client IP. See SECURITY.md finding T-01.
export async function POST(req: Request): Promise<Response> {
  const result = rateLimit(req, { id: "auth", limit: 10, windowMs: 60_000 });
  if (!result.ok) {
    return new Response(
      JSON.stringify({ error: "Too many requests" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(result.retryAfter),
        },
      }
    );
  }
  return handlers.POST(req);
}
