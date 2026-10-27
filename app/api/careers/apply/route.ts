import type { NextRequest } from "next/server";
import { withRateLimit } from "@/lib/api-helpers";
import { created, err, readJsonBody } from "@/lib/api-response";
import { applyToRole } from "@/lib/hiring/careers";
import { hiringErrorResponse } from "@/lib/hiring/http";
import { applySchema } from "@/lib/validations/hiring/public";

/**
 * PUBLIC BY DESIGN — apply to an advertised role (Interview Hub `POST
 * /api/careers/apply`). 5 per minute per IP; the role must be on the board
 * right now; an optional daily cap per role; one application per email per
 * role (case-insensitive, D18); consent required (D2). Lands as a NEW
 * application from the careers page — the applicant cannot pick a stage.
 */
export const POST = withRateLimit(
  async (req: NextRequest) => {
    const parsed = applySchema.safeParse(await readJsonBody(req));
    if (!parsed.success)
      return noStore(err(parsed.error.issues[0]?.message ?? "Check the form and try again.", 400));
    try {
      return noStore(created(await applyToRole(parsed.data)));
    } catch (e) {
      return noStore(hiringErrorResponse(e));
    }
  },
  { id: "careers-apply", limit: 5, windowMs: 60_000 },
);

function noStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
