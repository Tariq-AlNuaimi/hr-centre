import { NextRequest } from "next/server";
import { withCandidateToken, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { AssessmentStatus } from "@/generated/prisma/client";
import { responseSchema } from "@/lib/validations/candidate";
import {
  saveItemResponse,
  saveSjtResponse,
} from "@/lib/services/candidateRunner";

// Idempotent autosave of one answer (UI-SPEC C.2/C.3). Token-authorized. zod
// validates the payload; the SJT path also verifies (server-side) that the chosen
// option belongs to the item — the scoring key is never consulted client-side.
// Rejected once the sitting is SUBMITTED (no post-submit edits).
export const POST = withRateLimit(
  withCandidateToken(async (req: NextRequest, { invitation }) => {
    const assessment = invitation.assessment;
    if (!assessment) {
      return err("Consent is required before answering", 409);
    }
    if (assessment.status === AssessmentStatus.SUBMITTED) {
      return err("This assessment has already been submitted", 409);
    }

    const body = await req.json().catch(() => null);
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    if (parsed.data.kind === "item") {
      await saveItemResponse(assessment, parsed.data.itemNumber, parsed.data.value);
    } else {
      const saved = await saveSjtResponse(
        assessment,
        invitation.roleProfileId,
        parsed.data.sjtItemId,
        parsed.data.chosenOptionId
      );
      if (!saved) return err("Unknown SJT item or option", 422);
    }

    return ok({ saved: true });
  }),
  // Generous per-IP ceiling: a sitting autosaves ~125 answers over many minutes;
  // this bounds abuse without tripping a fast legitimate run (limiter is per-IP /
  // in-memory — see lib/rate-limit.ts; NAT collisions are the known caveat).
  { id: "candidate-response", limit: 300, windowMs: 60_000 }
);
