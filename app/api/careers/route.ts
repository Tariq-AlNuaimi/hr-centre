import { withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listOpenRoles } from "@/lib/hiring/careers";

/**
 * PUBLIC BY DESIGN — the careers board's open roles (Interview Hub `GET
 * /api/careers`, operator-approved public surface for the Hiring port).
 * Only roles that are OPEN, JD-signed and posted LIVE to the careers page;
 * title, company, department, JD text and posting date — never the band.
 * Rate-limited per IP; CDN-cacheable for a minute.
 */
export const GET = withRateLimit(
  async () => {
    const res = ok(await listOpenRoles());
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res;
  },
  { id: "careers-list", limit: 60, windowMs: 60_000 },
);
