import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { createCycleSchema } from "@/lib/validations/cycle";

/**
 * Performance cycles — spec §2.
 *
 * GET is open to any authenticated actor: which years exist and when their
 * deadlines fall is something every participant needs, and none of it is
 * personnel data. Creating one is HR's (§4.1 — Super Admin "full", HRBP "runs
 * the cycle org-wide"), which is `canRunCycle`, not `capabilities.configure`.
 */

export const GET = withRateLimit(
  withAuth(async () => {
    const cycles = await prisma.performanceCycle.findMany({
      orderBy: { year: "desc" },
      // Bounded: §2 is one cycle per year, so this is decades of history, not a
      // growth surface. Still capped rather than trusting that to stay true.
      take: 50,
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
    return ok(cycles);
  }),
  { id: "pms-cycles-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createCycleSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { year, stages } = parsed.data;

    const clash = await prisma.performanceCycle.findUnique({
      where: { year },
      select: { id: true },
    });
    if (clash) return err(`A cycle for ${year} already exists`, 409);

    // Created in DRAFT (§2): the three deadlines are set as one deliberate act,
    // and nothing is actionable until HR opens it. Participants are enrolled at
    // OPEN, not here, so a draft year does not manufacture 40 rows HR may
    // never use.
    const cycle = await prisma.performanceCycle.create({
      data: {
        year,
        status: "DRAFT",
        stages: {
          create: stages.map((s) => ({
            kind: s.kind,
            opensAt: s.opensAt,
            deadline: s.deadline,
            graceDays: s.graceDays,
          })),
        },
      },
      select: {
        id: true,
        year: true,
        status: true,
        stages: {
          select: { id: true, kind: true, opensAt: true, deadline: true, graceDays: true },
        },
      },
    });

    return created(cycle);
  }),
  { id: "pms-cycles-write", limit: 20, windowMs: 60_000 },
);
