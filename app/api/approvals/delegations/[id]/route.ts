import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { revokeDelegation } from "@/lib/core/approvals/store";

/** End one of MY delegations now. Another person's delegation is a 404 (no oracle). */
export const DELETE = withRateLimit(
  withAuth(async (_req: NextRequest, { session, params }) => {
    const { id } = await params;
    const done = await revokeDelegation(String(id ?? ""), session.user.id);
    return done ? ok({ revoked: true }) : notFound("Delegation");
  }),
  { id: "approval-delegations-revoke", limit: 30, windowMs: 60_000 },
);
