import { NextRequest, NextResponse } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-helpers";

// PUBLIC by design (allowlisted in rihal-template/no-bare-api-route): an uptime
// probe cannot require a session. It stays bare of an AUTH wrapper, but not of a
// rate limit -- every hit is a real DB round-trip, so unauthenticated and
// unthrottled made it a cheap amplifier against Neon (2026-07-25 review).
// The ceiling is generous: monitors poll every 30-60s, so 60/min/IP is far above
// legitimate use while still bounding a flood. The body exposes only DB
// reachability, never data.
export const GET = withRateLimit(
  async (_request: NextRequest) => {
    const checks: Record<string, string> = {};

    try {
      // Parameterized tagged-template form (not $queryRawUnsafe) to honor the
      // template's own "no raw-unsafe" hard rule, even for a constant query.
      await prismaUnfiltered.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch {
      checks.db = "error";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");

    return NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        checks,
        timestamp: new Date().toISOString(),
      },
      { status: allOk ? 200 : 503 },
    );
  },
  { id: "health", limit: 60, windowMs: 60_000 },
);
