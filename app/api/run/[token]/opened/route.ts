import { NextRequest } from "next/server";
import { withCandidateToken, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { markOpened } from "@/lib/services/invitation";

// OPENED beacon (UI-SPEC D.5 status tracking: sent → opened → started → …). The
// candidate runner fires this once on mount; it idempotently flips a PENDING
// invitation to OPENED so HR can see the link was viewed before consent. Token-
// authorized (no session); audited with the invitation's orgId + a NULL actor
// (the candidate is not a User). Rate-limit OUTSIDE the token gate.
export const POST = withRateLimit(
  withCandidateToken(async (_req: NextRequest, { invitation }) => {
    await markOpened({ id: invitation.id, status: invitation.status });
    return ok({ ok: true });
  }),
  { id: "candidate-opened", limit: 20, windowMs: 60_000 }
);
