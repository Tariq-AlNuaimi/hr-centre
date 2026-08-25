import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { createThreeSixtyCycleSchema } from "@/lib/validations/three-sixty";

/**
 * §9.1 — "Create a 360 cycle linked to the KPI assessment year, so 360 and KPI
 * scores tie to the same performance year."
 *
 * POST creates the cycle and its three templates (§9.2) in one act, because a
 * 360 cycle without templates cannot be answered and §9.7's activation would
 * refuse it anyway. Creating them together means there is no half-built state
 * for anyone to trip over.
 *
 * §4.1 — HR runs the cycle, including "360 setup". Nobody else.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR sets up the 360 cycle (§4.1).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createThreeSixtyCycleSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { cycleId, opensAt, deadline, templates } = parsed.data;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, status: true, threeSixty: { select: { id: true } } },
    });
    if (!cycle) return notFound("Cycle");
    if (cycle.threeSixty) {
      // §9.1 ties one 360 to one performance year. A second would make "the
      // employee's 360 ratio" ambiguous when §8.5 carries it into the formula.
      return err("This performance cycle already has a 360 cycle (§9.1).", 409);
    }
    if (cycle.status === "CLOSED") {
      return err("A closed cycle cannot take a new 360 (§2).", 409);
    }

    const threeSixty = await prisma.threeSixtyCycle.create({
      data: {
        cycleId,
        opensAt,
        deadline,
        templates: {
          create: templates.map((t) => ({
            type: t.type,
            questions: {
              create: t.questions.map((q, i) => ({
                text: q.text,
                orderIndex: i,
                scored: q.scored,
              })),
            },
          })),
        },
      },
      select: {
        id: true,
        status: true,
        opensAt: true,
        deadline: true,
        templates: {
          select: { id: true, type: true, _count: { select: { questions: true } } },
        },
      },
    });

    return created({ threeSixty });
  }),
  { id: "pms-360-write", limit: 30, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { cycleId },
      select: {
        id: true,
        status: true,
        opensAt: true,
        deadline: true,
        templates: {
          select: {
            id: true,
            type: true,
            questions: {
              select: { id: true, text: true, orderIndex: true, scored: true },
              orderBy: { orderIndex: "asc" },
              take: 60,
            },
          },
        },
        _count: { select: { assignments: true } },
      },
    });
    if (!threeSixty) return notFound("360 cycle");

    // The template TEXT is the questions everyone will answer — not confidential,
    // and a rater needs it. What stays HR-only is who was assigned to whom, which
    // lives on the assignments route.
    if (!actor.capabilities.orgWide && !actor.capabilities.lineManager) {
      // A plain employee reaches their own assignments through My Tasks; they do
      // not need the whole cycle's shape.
      return ok({
        threeSixty: {
          id: threeSixty.id,
          status: threeSixty.status,
          opensAt: threeSixty.opensAt,
          deadline: threeSixty.deadline,
        },
      });
    }
    return ok({ threeSixty });
  }),
  { id: "pms-360-read", limit: 120, windowMs: 60_000 },
);
