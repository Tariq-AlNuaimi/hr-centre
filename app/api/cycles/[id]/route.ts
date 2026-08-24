import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { canRunCycle, enrolParticipants } from "@/lib/pms/cycle";
import { cycleStatusSchema } from "@/lib/validations/cycle";

/**
 * One cycle — read it, or move it along §2's lifecycle.
 *
 * DRAFT → OPEN enrols every active employee (§3.5's "pull them into the cycle").
 * OPEN → CLOSED ends the year. Reopening is not offered: §10's calibration and
 * §13's publish gate both assume a closed year has stopped moving, and an
 * "undo" here would silently invalidate work downstream of it.
 */

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: {
        id: true,
        year: true,
        status: true,
        openedAt: true,
        openedBy: { select: { id: true, name: true } },
        stages: {
          orderBy: { opensAt: "asc" },
          select: { id: true, kind: true, opensAt: true, deadline: true, graceDays: true },
        },
        _count: { select: { participants: true } },
      },
    });
    if (!cycle) return notFound("Cycle");
    return ok(cycle);
  }),
  { id: "pms-cycle-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = cycleStatusSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const next = parsed.data.status;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: { id: true, status: true, year: true, _count: { select: { stages: true } } },
    });
    if (!cycle) return notFound("Cycle");

    // The lifecycle is one-way. Stating the legal transitions here rather than
    // inferring them keeps "why was that refused" answerable from one place.
    const legal =
      (cycle.status === "DRAFT" && next === "OPEN") ||
      (cycle.status === "OPEN" && next === "CLOSED");
    if (!legal) {
      return err(
        `A ${cycle.status} cycle cannot become ${next}. A cycle runs DRAFT → OPEN → CLOSED, ` +
          `and a closed year does not reopen.`,
        409,
      );
    }

    if (next === "OPEN" && cycle._count.stages !== 3) {
      return err(
        "A cycle needs all three stage deadlines before it opens — goal-setting, mid-year " +
          "and year-end (§2).",
        409,
      );
    }

    const updated = await prisma.performanceCycle.update({
      where: { id },
      data:
        next === "OPEN"
          ? { status: "OPEN", openedAt: new Date(), openedById: actor.employeeId }
          : { status: "CLOSED" },
      select: { id: true, year: true, status: true, openedAt: true },
    });

    // §3.5 — enrolment is idempotent, so opening a cycle and re-running it after
    // a later import are the same operation.
    const enrolled = next === "OPEN" ? await enrolParticipants(id) : { added: 0 };

    return ok({ ...updated, participantsAdded: enrolled.added });
  }),
  { id: "pms-cycle-write", limit: 20, windowMs: 60_000 },
);
