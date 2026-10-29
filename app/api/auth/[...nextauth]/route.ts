import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { throttleLogin, tooManyRequests } from "@/lib/rate-limit";

export const GET = handlers.GET;

// Brute-force defense for credentials login (and any other POST to /api/auth/*):
// 120/min per client IP, plus 10/min per account (normalised email) on a
// credentials sign-in. lib/auth.ts keeps its failed-login lockout underneath.
// Numbers live in AUTH_LIMITS (lib/rate-limit.ts); ADR-100, SECURITY.md T-01.
export async function POST(req: NextRequest): Promise<Response> {
  const result = await throttleLogin(req);
  if (!result.ok) return tooManyRequests(result);
  return handlers.POST(req);
}
