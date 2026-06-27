import { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { bulkInvitationSchema } from "@/lib/validations/invitation";
import { createInvitationsBulk } from "@/lib/services/invitation";

// Bulk tokenized send (UI-SPEC D.5 "Bulk"). The client parses paste/CSV into a
// recipient list and previews it; this re-validates the shapes, bounds the batch
// (MAX_BATCH via the schema), creates one batchId, and returns a per-recipient
// result. Admin-only; rate-limited OUTSIDE the auth wrapper (write + email fan-out).
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = bulkInvitationSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const baseUrl = process.env.AUTH_URL ?? request.nextUrl.origin;
    const res = await createInvitationsBulk({
      orgId,
      userId: session.user.id,
      baseUrl,
      input: parsed.data,
    });
    if (res.status !== 200) return err(res.error, res.status);
    return ok({ batchId: res.batchId, results: res.results, summary: res.summary });
  }),
  // A bulk send is one heavier request; keep the per-IP cap modest.
  { id: "invitation-bulk", limit: 10, windowMs: 60_000 }
);
