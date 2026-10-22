import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { employeeSelect, encryptSalary, serializeEmployee } from "@/lib/pms/employee-select";
import { canViewEmployee } from "@/lib/pms/permissions";
import { visibilityDescendants } from "@/lib/pms/org-tree";
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
    const descendants = await visibilityDescendants(actor);

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

    // ADR-067's binding. `odooId` is deliberately absent from
    // `updateEmployeeSchema` (it is a delete-and-recreate, not a field edit), so
    // it cannot change underneath an existing ciphertext — the AAD a row was
    // encrypted under is the AAD it will always be read under.
    const target = await prisma.employee.findUnique({
      where: { id },
      select: { odooId: true, status: true },
    });
    if (!target) return notFound("Employee not found");

    // ADR-069 — the third path that can off-board someone, after /api/leavers
    // and the import. HR fixing a record by hand is a quieter act than either,
    // which is exactly why it must not be the one that leaves a departed
    // employee's login alive. Guarded on the TRANSITION so re-saving an already
    // departed record does nothing.
    //
    // In the same transaction as the row it describes: a status that says LEAVER
    // beside an account that still works is the state this decision exists to
    // make impossible.
    // §12.1 — THIS ROUTE MAY NOT OFF-BOARD ANYONE.
    //
    // It used to accept the transition and revoke the login, which looks like a
    // departure and is not one: §12.1 also requires the direct reports to roll
    // up one level, with a `ManagerRollUp` row per report so §12.2's prompt
    // exists. None of that happens here. The result was a half-departure — a
    // revoked login beside a team still pointing at a manager who has gone —
    // and the only reason nobody hit it is that the edit form did not render
    // the field. Adding the field, which is what HR asked for, would have armed
    // it.
    //
    // So the transition is refused and named: one writer of a departure, and it
    // is `POST /api/leavers`, which the employee page's "Record departure"
    // action calls. Re-saving an ALREADY departed record is fine — that is not a
    // transition, and HR has to be able to correct a leaver's name.
    if (data.status === "LEAVER" && target.status !== "LEAVER") {
      return err(
        "Recording a departure does more than set these two fields: §12.1 also moves this " +
          "person's direct reports up one level and flags their 360 assignments for " +
          "reassignment. Use “Record departure” on the employee's record, which does all of it " +
          "in one step.",
        409,
      );
    }
    // Reinstating someone is likewise not a field edit: their reports were moved
    // and §12.2's prompt is open, so putting the status back would leave the org
    // chart rearranged with nothing saying why.
    //
    // THE MESSAGE SAYS WHAT IS ACTUALLY POSSIBLE. Its first draft said "resolve
    // it on Leavers & transfers first", which was wrong twice: that screen
    // resolves a roll-up but never writes `status`, and this guard does not
    // test whether the roll-up was resolved, so the refusal would have stood
    // after HR did as they were told. Rehire/reactivation is a documented v1
    // gap (ADR-045) — logged in docs/findings-register.md rather than papered
    // over with a route that half-does it, since reinstating properly means
    // putting a reporting line back and restoring a revoked account, and
    // neither is a field edit either.
    if (data.status === "ACTIVE" && target.status === "LEAVER") {
      return err(
        "Bringing a departed employee back is not supported in this version, and is not a field " +
          "edit: when they left, their direct reports were moved up a level (§12.1) and their " +
          "login was revoked. Re-import them from the employee sheet to restore the record, " +
          "restore their account from the Recycling bin to give them access again, and set " +
          "their team's reporting lines on the employee records that need to change.",
        409,
      );
    }

    const updated = await auditedTransaction(async (tx) => {
      return tx.employee.update({
        where: { id },
        data: {
          name: data.name,
          email: data.email,
          // §3.3's anchor for §11. Until now the ONLY writer was the import, so a
          // wrong or missing joining date could be corrected no other way — and a
          // re-import is precisely the expensive act the hand-editing path exists
          // to avoid (red-team F13).
          dateOfJoining: data.dateOfJoining ? new Date(`${data.dateOfJoining}T00:00:00Z`) : null,
          departmentId: data.departmentId,
          entityId: data.entityId,
          managerId: data.managerId,
          roleTrack: data.roleTrack,
          pmsRoles: data.pmsRoles,
          basicSalaryEnc: encryptSalary(data.basicSalary, target.odooId),
          status: data.status,
          lastWorkingDay: data.lastWorkingDay ? new Date(`${data.lastWorkingDay}T00:00:00Z`) : null,
          unpaidLeaveDays: data.unpaidLeaveDays,
        },
        select: employeeSelect(actor),
      });
    });

    return ok(serializeEmployee(updated));
  }),
  { id: "pms-employee-write", limit: 30, windowMs: 60_000 },
);
