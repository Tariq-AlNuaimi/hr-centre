import { NextRequest } from "next/server";
import { withCandidateToken, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { AssessmentStatus } from "@/generated/prisma/client";
import { consentSchema } from "@/lib/validations/candidate";
import { recordConsent } from "@/lib/services/candidateRunner";

// Record PDPL consent and open the sitting (UI-SPEC C.1). Token-authorized (no
// session). Consent is captured BEFORE any item response is accepted — the runner
// gates the questions on a 200 here. Idempotent (reload-safe). Rate-limit OUTSIDE
// the token gate so a flood is throttled before the DB lookup.
export const POST = withRateLimit(
  withCandidateToken(async (req: NextRequest, { invitation }) => {
    // A submitted sitting is closed — don't signal "cleared to answer" (the page
    // RSC already shows the completed screen; this guards machine clients/retries).
    if (invitation.assessment?.status === AssessmentStatus.SUBMITTED) {
      return err("This assessment has already been submitted", 409);
    }

    const body = await req.json().catch(() => null);
    const parsed = consentSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const locale = parsed.data.locale ?? invitation.locale;
    const assessment = await recordConsent(invitation, locale);
    return ok({ assessmentId: assessment.id, locale: assessment.locale });
  }),
  { id: "candidate-consent", limit: 20, windowMs: 60_000 }
);
