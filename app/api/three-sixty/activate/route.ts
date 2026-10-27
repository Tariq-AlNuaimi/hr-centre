import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { activationBlockedReason } from "@/lib/pms/three-sixty";
import { activateSchema } from "@/lib/validations/three-sixty";

/**
 * §9.7 — "Publish/activate the cycle; send automated invitations."
 *
 * The activation gate is where §9.4's "exactly 3 raters per employee" finally
 * bites. It is checked HERE rather than on every assignment edit because §9.6
 * has HR building and revising the set first — refusing to save a half-built
 * set would make the review step impossible. So the count is demanded at the
 * moment the cycle becomes real to raters, which is the moment it matters.
 *
 * Invitations are best-effort: `lib/email.ts` no-ops unless SMTP is configured,
 * and in-app surfacing through My Tasks (§4.4) is the primary channel. The
 * assignment appearing in someone's task list IS the invitation.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR activates the 360 cycle.", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = activateSchema.safeParse(body);
    if (!parsed.success) return err("threeSixtyCycleId is required");
    const { threeSixtyCycleId } = parsed.data;

    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: {
        id: true,
        status: true,
        templates: { select: { type: true, _count: { select: { questions: true } } } },
      },
    });
    if (!threeSixty) return notFound("360 cycle");
    if (threeSixty.status !== "DRAFT") {
      return err(`This 360 cycle is already ${threeSixty.status.toLowerCase()}.`, 409);
    }

    // Rater counts per ratee, read from the assignments themselves rather than
    // from a stored tally — a tally is a second source of truth that drifts the
    // first time someone edits an assignment by hand (§9.6).
    const rows = await prisma.assignment.findMany({
      where: { threeSixtyCycleId },
      take: 8000,
      select: { rateeId: true },
    });
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.rateeId, (counts.get(r.rateeId) ?? 0) + 1);

    const blocked = activationBlockedReason({
      templates: threeSixty.templates.map((t) => ({
        type: t.type,
        questionCount: t._count.questions,
      })),
      counts: [...counts.entries()].map(([rateeId, raterCount]) => ({ rateeId, raterCount })),
      participantCount: counts.size,
    });
    if (blocked) return err(blocked, 409);

    const updated = await prisma.threeSixtyCycle.update({
      where: { id: threeSixtyCycleId },
      data: { status: "ACTIVE" },
      select: { id: true, status: true, opensAt: true, deadline: true },
    });

    return ok({ threeSixty: updated, assignmentCount: rows.length, rateeCount: counts.size });
  }),
  { id: "pms-360-write", limit: 10, windowMs: 60_000 },
);
