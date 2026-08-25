import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import {
  isThreeSixtyExempt,
  proposeRaters,
  templateTypeFor,
  type RaterCandidate,
} from "@/lib/pms/three-sixty";
import { setAssignmentsSchema } from "@/lib/validations/three-sixty";

/**
 * §9.6 — "Define employee relationships/mapping (manager, peer, reportee), then
 * auto-generate assignments from the mapping … HR reviews and edits assignments
 * before launch."
 *
 * Two verbs, matching that sentence:
 *   PUT  — auto-generate the whole set from the mapping (the "then" above)
 *   POST — set one employee's raters by hand (the "reviews and edits")
 *
 * §4.1 gives 360 setup to HR. Nobody else generates or edits assignments, and
 * §9.4's "HR selects and manages all rater assignments" says so twice.
 */

const CANDIDATE_SELECT = {
  id: true,
  managerId: true,
  roleTrack: true,
  departmentId: true,
  status: true,
} as const;

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR manages rater assignments (§9.4).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const threeSixtyCycleId = (body as { threeSixtyCycleId?: string }).threeSixtyCycleId;
    if (!threeSixtyCycleId) return err("threeSixtyCycleId is required");

    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: {
        id: true,
        status: true,
        cycleId: true,
        templates: { select: { id: true, type: true } },
      },
    });
    if (!threeSixty) return notFound("360 cycle");
    if (threeSixty.status !== "DRAFT") {
      // §9.6 puts HR's review BEFORE launch. Regenerating under an ACTIVE cycle
      // would delete assignments raters are part-way through answering.
      return err("Assignments are generated while the 360 cycle is a draft (§9.6).", 409);
    }

    const templateByType = new Map(threeSixty.templates.map((t) => [t.type, t.id]));

    // Everyone enrolled in the performance year, minus §8.3's exemptions.
    const participants = await prisma.cycleParticipant.findMany({
      where: { cycleId: threeSixty.cycleId },
      take: 2000,
      select: { employee: { select: CANDIDATE_SELECT } },
    });
    const people: RaterCandidate[] = participants.map((p) => p.employee);
    const byId = new Map(people.map((p) => [p.id, p]));

    const rateable = people.filter(
      (p) => p.status === "ACTIVE" && !isThreeSixtyExempt(p.roleTrack),
    );

    let created = 0;
    const shortfalls: { rateeId: string; missing: number }[] = [];

    // Replace rather than append: PUT regenerates the mapping, and leaving the
    // previous run's rows would double-assign anyone whose relationships moved.
    //
    // A bulk delete with ONE summary audit row rather than a per-row loop. The
    // rule's own remedy, chosen because this only ever runs on a DRAFT cycle
    // whose assignments nobody has answered yet — so there is no individual
    // response history to preserve, and a per-row loop over a few thousand
    // never-touched rows buys nothing but round trips. What matters for the
    // trail is that HR regenerated, and when.
    const wiped = await prisma.assignment.count({ where: { threeSixtyCycleId } });
    // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- DRAFT-only regenerate; recordAudit() below
    await prisma.assignment.deleteMany({ where: { threeSixtyCycleId } });
    await recordAudit(prisma, {
      entityType: "Assignment",
      entityId: threeSixtyCycleId,
      action: "DELETE",
      before: { assignmentCount: wiped },
      after: { assignmentCount: 0, reason: "regenerated from the relationship mapping (§9.6)" },
    });

    // The creates below are NOT wrapped in a transaction, deliberately. A few
    // thousand per-row creates would exceed the interactive-transaction timeout,
    // and a half-generated DRAFT set is a state the system already handles
    // correctly: §9.7's activation gate refuses to launch until every ratee has
    // exactly three raters, so a partial run surfaces as a blocked activation
    // rather than as a silently short 360.

    for (const ratee of rateable) {
      const lineManager = ratee.managerId ? (byId.get(ratee.managerId) ?? null) : null;
      const reports = people.filter((p) => p.managerId === ratee.id);
      // §9.4's peer pool: same department first, then anyone sharing a project
      // (§9.6). Both are "someone they worked with"; department is the cheaper
      // and more reliable signal, so it leads.
      const peerPool = people.filter(
        (p) =>
          p.id !== ratee.id &&
          p.id !== ratee.managerId &&
          p.departmentId !== null &&
          p.departmentId === ratee.departmentId,
      );

      const { raterIds, shortfall } = proposeRaters({ ratee, lineManager, reports, peerPool });
      if (shortfall > 0) shortfalls.push({ rateeId: ratee.id, missing: shortfall });

      for (const raterId of raterIds) {
        const rater = byId.get(raterId);
        if (!rater) continue;
        const type = templateTypeFor({ rater, ratee });
        if (type === null) continue;
        const templateId = templateByType.get(type);
        if (!templateId) continue;

        await prisma.assignment.create({
          data: { threeSixtyCycleId, rateeId: ratee.id, raterId, templateId },
          select: { id: true },
        });
        created += 1;
      }
    }

    // Shortfalls are REPORTED, never padded. §9.4 wants exactly three, and
    // §9.7's activation gate refuses to launch until HR has filled the gaps by
    // hand — which is what the POST below is for.
    return ok({ created, rateeCount: rateable.length, shortfalls });
  }),
  { id: "pms-360-write", limit: 10, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR manages rater assignments (§9.4).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = setAssignmentsSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { threeSixtyCycleId, rateeId, raterIds } = parsed.data;

    const threeSixty = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: {
        id: true,
        status: true,
        cycleId: true,
        templates: { select: { id: true, type: true } },
      },
    });
    if (!threeSixty) return notFound("360 cycle");
    if (threeSixty.status !== "DRAFT") {
      return err("Assignments are edited before the cycle is activated (§9.6).", 409);
    }

    const ratee = await prisma.employee.findUnique({
      where: { id: rateeId },
      select: CANDIDATE_SELECT,
    });
    if (!ratee) return notFound("Employee");
    if (isThreeSixtyExempt(ratee.roleTrack)) {
      return err("C-Level skip the 360 entirely (§8.3).", 409);
    }
    if (raterIds.includes(rateeId)) {
      return err("Nobody assesses themselves — §7.1 is where a self-assessment lives.", 400);
    }

    const raters = await prisma.employee.findMany({
      where: { id: { in: raterIds } },
      take: 10,
      select: CANDIDATE_SELECT,
    });
    if (raters.length !== raterIds.length) return notFound("Rater");

    const exempt = raters.filter((r) => isThreeSixtyExempt(r.roleTrack));
    if (exempt.length > 0) {
      return err(
        `C-Level are excused from 360 work entirely (§8.3) — ${exempt.length} named.`,
        409,
      );
    }
    const leavers = raters.filter((r) => r.status !== "ACTIVE");
    if (leavers.length > 0) {
      return err(`${leavers.length} of those raters have left (§12.1) — choose someone else.`, 409);
    }

    const templateByType = new Map(threeSixty.templates.map((t) => [t.type, t.id]));

    await prisma.$transaction(async (tx) => {
      // Replace this ratee's set wholesale — that is what "set the raters" means,
      // and a partial edit would leave the previous rater assigned to a form HR
      // has just decided they should not fill in.
      const existing = await tx.assignment.findMany({
        where: { threeSixtyCycleId, rateeId },
        take: 50,
        select: { id: true },
      });
      for (const row of existing) await tx.assignment.delete({ where: { id: row.id } });

      for (const rater of raters) {
        const type = templateTypeFor({ rater, ratee });
        if (type === null) continue;
        const templateId = templateByType.get(type);
        if (!templateId) continue;
        await tx.assignment.create({
          data: { threeSixtyCycleId, rateeId, raterId: rater.id, templateId },
          select: { id: true },
        });
      }
    });

    const assignments = await prisma.assignment.findMany({
      where: { threeSixtyCycleId, rateeId },
      take: 50,
      select: {
        id: true,
        status: true,
        rater: { select: { id: true, name: true } },
        template: { select: { type: true } },
      },
    });
    return ok({ rateeId, assignments });
  }),
  { id: "pms-360-write", limit: 60, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const url = new URL(request.url);
    const threeSixtyCycleId = url.searchParams.get("threeSixtyCycleId");
    if (!threeSixtyCycleId) return err("threeSixtyCycleId is required");

    // §9.4 — "HR selects and manages all rater assignments", so the who-assesses-
    // whom map is HR's. A rater sees only their OWN assignments, which reach them
    // through My Tasks (§4.4) rather than through this list: knowing the full map
    // is how a ratee works out who said what, and §13.1 protects that anonymity.
    if (!isHr(actor)) {
      const mine = await prisma.assignment.findMany({
        where: { threeSixtyCycleId, raterId: actor.employeeId ?? "" },
        take: 100,
        select: {
          id: true,
          status: true,
          ratee: { select: { id: true, name: true } },
          template: { select: { type: true } },
        },
      });
      return ok({ assignments: mine, scope: "mine" });
    }

    const rows = await prisma.assignment.findMany({
      where: { threeSixtyCycleId },
      take: 4000,
      select: {
        id: true,
        status: true,
        submittedAt: true,
        ratee: { select: { id: true, name: true, departmentId: true } },
        rater: { select: { id: true, name: true } },
        template: { select: { type: true } },
      },
      orderBy: [{ rateeId: "asc" }],
    });

    // §9.4's count per ratee, so HR can see at a glance who is short before
    // trying to activate.
    const byRatee = new Map<string, { name: string; raterCount: number }>();
    for (const row of rows) {
      const entry = byRatee.get(row.ratee.id) ?? { name: row.ratee.name, raterCount: 0 };
      entry.raterCount += 1;
      byRatee.set(row.ratee.id, entry);
    }

    return ok({
      assignments: rows,
      scope: "all",
      coverage: [...byRatee.entries()].map(([rateeId, v]) => ({ rateeId, ...v })),
    });
  }),
  { id: "pms-360-read", limit: 120, windowMs: 60_000 },
);
