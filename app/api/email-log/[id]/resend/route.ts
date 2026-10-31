import type { NextRequest } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err } from "@/lib/api-response";
import { resendTarget } from "@/lib/core/email/log";
import { retryEmail } from "@/lib/jml/email/queue";

/**
 * Send a logged email again, where its module supports it (JML's queue: a NEW
 * queued row linked to the original, AC-7.4). Platform administrators only.
 */
export const POST = withRateLimit(
  withAdminAuth(async (_req: NextRequest, { session, params }) => {
    const target = await resendTarget(String((await params).id ?? ""));
    if ("problem" in target) return err(target.problem, target.status);
    return created(await retryEmail(target.id, session.user.id));
  }),
  { id: "email-log-resend", limit: 30, windowMs: 60_000 },
);
