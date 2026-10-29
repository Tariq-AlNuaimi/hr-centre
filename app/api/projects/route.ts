import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/core/actor";
import { isHr } from "@/lib/core/permissions";
import { upsertProjectSchema } from "@/lib/validations/three-sixty";

/**
 * §9.6's optional project mapping.
 *
 * "Projects (optional): ability to create projects and link employees, so peers
 * can be drawn from shared project work. Not applicable to everyone. v1:
 * projects added/linked manually. Future: link to the separate projects system
 * being built."
 *
 * So: HR-maintained, cycle-scoped, and deliberately thin. This is a RELATIONSHIP
 * MAP, not a project-management feature — it has a name and a membership list
 * and nothing else, because everything else belongs to the separate system §14
 * says will own this in v2. Building more here would be work thrown away.
 *
 * The membership list is REPLACED on each write rather than diffed. A project's
 * membership is a small set HR edits as a whole, and a replace makes "these are
 * the people" true by construction instead of by a sequence of adds and removes
 * that can half-apply.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR maintains the project mapping.", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = upsertProjectSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { cycleId, name, memberEmployeeIds } = parsed.data;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true },
    });
    if (!cycle) return notFound("Cycle");

    // Every named member must exist, or the peer pool silently loses someone HR
    // believes they added.
    const uniqueIds = [...new Set(memberEmployeeIds)];
    const members = await prisma.employee.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      take: 200,
      select: { id: true },
    });
    if (members.length !== uniqueIds.length) {
      return err("One or more of those employees does not exist.", 409);
    }

    const existing = await prisma.project.findUnique({
      where: { cycleId_name: { cycleId, name } },
      select: { id: true, members: { select: { employeeId: true }, take: 200 } },
    });

    const project = await auditedTransaction(async (tx) => {
      const row = existing
        ? { id: existing.id, name }
        : await tx.project.create({ data: { cycleId, name }, select: { id: true, name: true } });

      if (existing) {
        // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- membership replace; recordAudit() below
        await tx.projectMember.deleteMany({ where: { projectId: row.id } });
      }
      for (const member of members) {
        await tx.projectMember.create({
          data: { projectId: row.id, employeeId: member.id },
          select: { id: true },
        });
      }

      // The MEMBERSHIP, not its size. A replace that swaps one person for another
      // leaves `memberCount` identical, and `computeChanges` reports only keys
      // that differ — so the audit row for the write §9.6 most cares about said
      // nothing at all. Sorted, so a reordering is not reported as a change.
      //
      // `name` is on both sides because the two snapshots must share their keys
      // (`recordAudit` diffs only shared keys). It cannot actually move: the
      // project is looked up by `cycleId_name`, so a different name is a
      // different project, and stating it is a statement of what this row is.
      const memberIds = (ids: string[]) => [...ids].sort();
      await recordAudit(tx, {
        entityType: "Project",
        entityId: row.id,
        action: existing ? "UPDATE" : "CREATE",
        ...(existing
          ? {
              before: {
                name,
                memberEmployeeIds: memberIds(existing.members.map((m) => m.employeeId)),
              },
            }
          : {}),
        after: { name, memberEmployeeIds: memberIds(members.map((m) => m.id)) },
      });
      return row;
    });

    return existing ? ok({ project }) : created({ project });
  }),
  { id: "pms-project-write", limit: 30, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("The project mapping is HR's.", 403);

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const projects = await prisma.project.findMany({
      where: { cycleId },
      take: 500,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        members: {
          take: 200,
          select: { employee: { select: { id: true, name: true, odooId: true } } },
        },
      },
    });

    return ok({
      cycleId,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        members: p.members.map((m) => m.employee),
      })),
    });
  }),
  { id: "pms-project-read", limit: 60, windowMs: 60_000 },
);
