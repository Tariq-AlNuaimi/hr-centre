import { NextRequest } from "next/server";
import { withCandidateToken, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { AssessmentStatus } from "@/generated/prisma/client";
import { submitAssessment } from "@/lib/services/candidateRunner";

// Submit the sitting (UI-SPEC C.4). Token-authorized. Marks the Assessment
// SUBMITTED + the Invitation COMPLETED. Idempotent-ish: a re-submit on an already-
// submitted sitting returns 409 (the completion screen handles it). Result/scoring
// roll-up is Phase 6 — Phase 4 stops at captured responses.
export const POST = withRateLimit(
  withCandidateToken(async (_req: NextRequest, { invitation }) => {
    const assessment = invitation.assessment;
    if (!assessment) {
      return err("Nothing to submit — consent first", 409);
    }
    if (assessment.status === AssessmentStatus.SUBMITTED) {
      return err("This assessment has already been submitted", 409);
    }

    await submitAssessment({ id: assessment.id, invitationId: invitation.id });
    return ok({ submitted: true });
  }),
  { id: "candidate-submit", limit: 20, windowMs: 60_000 }
);
