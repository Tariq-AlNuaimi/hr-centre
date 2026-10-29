import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { isHr } from "@/lib/core/permissions";
import { CYCLE_POLICY_SELECT, policyEditBlockedReason, policyFor } from "@/lib/pms/cycle-policy";
import { cyclePolicySchema } from "@/lib/validations/cycle";

/**
 * The three clauses §1–§14 leaves open (§6.2, §7.1, §8.7), as HR's answers.
 *
 * Why this route exists at all: each of those clauses admits more than one
 * reading, the build had to pick one, and a choice made by the build is a choice
 * Rihal has not made (docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md). This turns
 * an answer from HR into a form to fill in rather than a code change and a
 * deploy.
 *
 * TWO GATES, AND BOTH ARE THE POINT:
 *
 *   §4.1 gives cycle setup to HR, so nobody else may write here.
 *
 *   The cycle must be a DRAFT. Once it is OPEN people have signed and rated
 *   under these rules; moving the divergence rule underneath them invalidates
 *   work already done, and moving the band rule re-prices a bonus after the fact
 *   (§11.3). The form disables too, but THIS is the boundary — a disabled input
 *   is a courtesy, not a control.
 */

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: { id: true, status: true, ...CYCLE_POLICY_SELECT },
    });
    if (!cycle) return notFound("Cycle");
    // Readable by any signed-in actor: the rules a cycle is judged by are not a
    // secret from the people being judged by them, and §13.1's scorecard shows
    // the band this policy decides.
    return ok({
      policy: policyFor(cycle),
      editable: policyEditBlockedReason(cycle.status) === null,
    });
  }),
  { id: "cycle-policy-read", limit: 60, windowMs: 60_000 },
);

export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { session, params }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR sets the cycle policy.", 403);

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = cyclePolicySchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Invalid request");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: { id: true, status: true, ...CYCLE_POLICY_SELECT },
    });
    if (!cycle) return notFound("Cycle");

    const blocked = policyEditBlockedReason(cycle.status);
    if (blocked) return err(blocked, 409);

    // A plain `update` through the audited client: one row, no predicate a
    // unique `where` cannot carry, so no bulk-write escape hatch is needed and
    // the audit row records exactly which answer moved.
    const updated = await prisma.performanceCycle.update({
      where: { id },
      data: parsed.data,
      select: { id: true, status: true, ...CYCLE_POLICY_SELECT },
    });

    return ok({ policy: policyFor(updated), editable: true });
  }),
  { id: "cycle-policy-write", limit: 20, windowMs: 60_000 },
);
