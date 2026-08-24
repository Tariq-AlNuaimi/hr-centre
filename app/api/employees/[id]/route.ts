import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeSelect, serializeEmployee } from "@/lib/pms/employee-select";
import { canViewEmployee } from "@/lib/pms/permissions";
import { descendantEmployeeIds } from "@/lib/pms/org-tree";
import { updateEmployeeSchema } from "@/lib/validations/employee";

/**
 * One employee record — spec §4.2 / §4.5.
 *
 * GET mirrors the list route's two rules (which rows, which columns). PUT is
 * gated on `canConfigure`, which §4.1 grants to HR Super Admin alone: a line
 * manager acts on their reports' ASSESSMENTS (Phase 2+), never on their org
 * record, and an executive viewer acts on nothing at all.
 */

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    // The descendant set is only computed for an actor who needs it — HR and
    // executives short-circuit on org-wide visibility inside canViewEmployee.
    const descendants = actor.capabilities.orgWide
      ? new Set<string>()
      : actor.employeeId
        ? await descendantEmployeeIds(actor.employeeId)
        : new Set<string>();

    if (!canViewEmployee(actor, id, descendants)) {
      // 404, not 403: a manager probing ids should not be able to learn that an
      // employee exists outside their chain by the difference in status code.
      return notFound("Employee");
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: employeeSelect(actor),
    });
    if (!employee) return notFound("Employee");

    return ok(serializeEmployee(employee));
  }),
  { id: "pms-employee-read", limit: 120, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    // §4.1 "Configures? HR Super Admin: Yes — full", everyone else "No".
    if (!actor.capabilities.configure) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const data = parsed.data;

    const existing = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, entityId: true },
    });
    if (!existing) return notFound("Employee");

    // §1.2 — the denormalised entity must agree with the department's own.
    // A composite FK enforces this in the database; checking here turns a
    // constraint violation into a field-level message.
    if (data.departmentId) {
      const department = await prisma.department.findUnique({
        where: { id: data.departmentId },
        select: { entityId: true },
      });
      if (!department) return err("departmentId: that department does not exist");
      if (department.entityId !== data.entityId) {
        return err("departmentId: that department belongs to a different entity");
      }
    }

    if (data.managerId) {
      if (data.managerId === id) return err("managerId: an employee cannot be their own manager");
      // A manager must exist. Reachability is not checked beyond that: the
      // upward walk in lib/pms/org-tree.ts is depth-capped, and a cycle created
      // by two separate legitimate edits is caught there rather than by
      // refusing an otherwise-valid single edit.
      const manager = await prisma.employee.findUnique({
        where: { id: data.managerId },
        select: { id: true },
      });
      if (!manager) return err("managerId: that employee does not exist");
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        departmentId: data.departmentId,
        entityId: data.entityId,
        managerId: data.managerId,
        roleTrack: data.roleTrack,
        pmsRoles: data.pmsRoles,
        basicSalary: data.basicSalary,
        status: data.status,
        lastWorkingDay: data.lastWorkingDay ? new Date(`${data.lastWorkingDay}T00:00:00Z`) : null,
        unpaidLeaveDays: data.unpaidLeaveDays,
      },
      select: employeeSelect(actor),
    });

    return ok(serializeEmployee(updated));
  }),
  { id: "pms-employee-write", limit: 30, windowMs: 60_000 },
);
