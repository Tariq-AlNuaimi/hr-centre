import { NextRequest, NextResponse } from "next/server";
import { prismaUnfiltered } from "@/lib/prisma";
import { withRateLimit } from "@/lib/api-helpers";
import { ipTrustIsConfigured } from "@/lib/client-ip";

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

    // Rate limiting is only as good as the IP header it keys on. With neither
    // RATE_LIMIT_TRUSTED_IP_HEADER nor a platform that overwrites the header, the
    // key comes from a client-supplied value and per-IP limits are evadable by
    // rotating it. That is a deliberate choice -- the alternative collapsed every
    // caller into one shared bucket and handed strangers a global auth outage
    // (review round 8) -- but it must not degrade SILENTLY, so it is reported.
    // It is a WARNING, deliberately kept out of `checks`: the app is serving
    // correctly, only the throttle is weaker, and an uptime monitor must not be
    // paged (or the deploy rolled back) over a configuration advisory.
    const warnings = ipTrustIsConfigured() ? [] : ["ip-trust-unconfigured"];

    return NextResponse.json(
      {
        status: allOk ? "ok" : "degraded",
        checks,
        ...(warnings.length > 0 ? { warnings } : {}),
        timestamp: new Date().toISOString(),
      },
      { status: allOk ? 200 : 503 },
    );
  },
  { id: "health", limit: 60, windowMs: 60_000 },
);
