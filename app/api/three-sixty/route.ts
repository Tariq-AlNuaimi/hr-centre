import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { windowChangeBlockedReason } from "@/lib/pms/three-sixty-edit";
import {
  amendThreeSixtyWindowSchema,
  createThreeSixtyCycleSchema,
} from "@/lib/validations/three-sixty";

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
    if (!isHr(actor)) return err("Only HR sets up the 360 cycle.", 403);

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
      return err("This performance cycle already has a 360 cycle.", 409);
    }
    if (cycle.status === "CLOSED") {
      return err("A closed cycle cannot take a new 360.", 409);
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

/**
 * §9.1 — correcting the window before the cycle goes live.
 *
 * The dates were write-once. A 360 created with a mistyped `opensAt` could never
 * be amended and never be deleted, so one slip fixed the whole performance
 * year's 360 window wrongly — and §5.4 makes a deadline a hard lock, which is
 * exactly why the mistake had to be correctable before anyone is standing
 * behind it. Found while verifying §9.8's report (`SPEC-REDTEAM.md`, F10).
 *
 * DRAFT only. Once §9.7 activates the cycle the window has been announced to
 * raters through their task lists, and moving a deadline underneath someone who
 * is part-way through a form is a different act entirely — one the spec does
 * not ask for.
 */
export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR sets up the 360 cycle.", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = amendThreeSixtyWindowSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { threeSixtyCycleId, opensAt, deadline } = parsed.data;

    // One read: it answers "does it exist", "is its year still open", and
    // supplies the `before` half of the audit row below.
    const before = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: {
        id: true,
        status: true,
        opensAt: true,
        deadline: true,
        cycle: { select: { status: true } },
      },
    });
    if (!before) return notFound("360 cycle");

    // §9.7 — the window USED to be draft-only, with "the window is fixed once
    // the cycle is activated". That reasoning is right for pulling a deadline
    // forward and wrong for pushing it back, and the route treated both as one
    // act: a cycle that needed another week was simply over, with nothing in
    // the product able to say otherwise. The direction is what matters now,
    // and the rules live in `lib/pms/three-sixty-edit.ts` so the editor on
    // screen refuses exactly what this route refuses.
    const blocked = windowChangeBlockedReason({
      cycleStatus: before.status,
      performanceYearStatus: before.cycle.status,
      currentOpensAt: before.opensAt,
      currentDeadline: before.deadline,
      nextOpensAt: opensAt,
      nextDeadline: deadline,
      now: new Date(),
    });
    if (blocked) return err(blocked.reason, blocked.status);

    // ONE conditional statement, not a read then a write: a status change
    // landing between them would move the window on a cycle whose rules have
    // just changed underneath this decision. `updateMany` is what expresses
    // "update only if it is still what I checked" in Prisma — a Serializable
    // transaction would express it too, but the audit row it writes commits on
    // a client outside the transaction, so a losing race would record a move
    // that never happened.
    //
    // `updateMany` skips the audit extension, so the row is written explicitly
    // below (ADR-010's documented escape hatch) — and only when the update
    // actually landed.
    // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- audited explicitly below; a conditional single-row update is the point (see comment)
    const moved = await prisma.threeSixtyCycle.updateMany({
      where: { id: threeSixtyCycleId, status: before.status },
      data: { opensAt, deadline },
    });
    if (moved.count === 0) {
      return err(
        "Somebody else changed this cycle while you were looking at it. Reload and try again.",
        409,
      );
    }

    const threeSixty = await prisma.threeSixtyCycle.findUniqueOrThrow({
      where: { id: threeSixtyCycleId },
      select: { id: true, status: true, opensAt: true, deadline: true },
    });
    await recordAudit(prisma, {
      entityType: "ThreeSixtyCycle",
      entityId: threeSixty.id,
      action: "UPDATE",
      before: {
        id: before.id,
        status: before.status,
        opensAt: before.opensAt,
        deadline: before.deadline,
      },
      after: threeSixty,
    });

    return ok({ threeSixty });
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
