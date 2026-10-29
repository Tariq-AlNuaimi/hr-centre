import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { createDelegation, delegationsOf } from "@/lib/core/approvals/store";
import { canDelegateApprovals, canReceiveDelegation } from "@/lib/core/approvals/delegation-access";
import { delegationSchema } from "@/lib/validations/core/approvals";

/** The viewer's approval delegations, given and received (ADR-094). */
export const GET = withRateLimit(
  withAuth(async (_req: NextRequest, { session }) => ok(await delegationsOf(session.user.id))),
  { id: "approval-delegations-read", limit: 120, windowMs: 60_000 },
);

/** Delegate my approvals to a colleague for a period. Only someone who approves may. */
export const POST = withRateLimit(
  withAuth(async (req: NextRequest, { session }) => {
    const parsed = delegationSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid delegation", 422);
    const d = parsed.data;
    if (d.delegateId === session.user.id) return err("Choose someone other than yourself.", 422);
    if (!(await canDelegateApprovals(session.user.id, d.module))) return forbidden();
    if (!(await canReceiveDelegation(d.delegateId, d.module)))
      return err("That person can't open hiring records, so they couldn't decide for you.", 422);
    return created(await createDelegation({ ...d, delegatorId: session.user.id }));
  }),
  { id: "approval-delegations-write", limit: 30, windowMs: 60_000 },
);
