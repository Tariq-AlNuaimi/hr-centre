import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { generateCalibration } from "@/lib/services/calibration";

// POST /api/calibration/[roleProfileId]/generate — generate (and persist, when
// sufficient) the advisory calibration report for a role-profile version
// (ARCHITECTURE §7, UI-SPEC D.9). withAdminAuth (the maturity loop is an admin
// governance surface); orgId-scoped; rate limited OUTSIDE (it reads the role's full
// outcome population + writes a report). The report only SUGGESTS band directions —
// it never writes a band. An under-populated role is an honest 409, not an error.
export const POST = withRateLimit(
  withAdminAuth(async (_request: NextRequest, { params, session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { roleProfileId } = await params;

    const outcome = await generateCalibration(orgId, session.user.id, roleProfileId);
    switch (outcome.kind) {
      case "ok":
        return ok({ report: outcome.report, sampleSize: outcome.sampleSize, generatedAt: outcome.generatedAt });
      case "insufficient":
        return err(
          `Not enough recorded outcomes to calibrate yet — ${outcome.have} of ${outcome.need} needed`,
          409
        );
      case "not-found":
        return err("Role profile not found", 404);
    }
  }),
  { id: "calibration-generate", limit: 10, windowMs: 60_000 }
);
