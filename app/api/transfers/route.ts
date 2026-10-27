import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHrSuperAdmin } from "@/lib/pms/permissions";
import { periodDays, periodWeight, splitWindows } from "@/lib/pms/transfer";
import { splitAndMove } from "@/lib/pms/transfer-apply";
import { recordTransferSchema } from "@/lib/validations/edge-cases";

/**
 * §12.3 — transfers mid-cycle (department / entity change).
 *
 * "Individual KPIs are split across the two periods: Old department's KPIs cover
 * the pre-transfer period; new department's KPIs cover the post-transfer period.
 * Each department's manager drafts and assesses their own portion's KPIs; HR
 * signs off / consolidates (neither manager owns the full year)."
 *
 * ## What POST does, in one transaction
 *
 *  1. Creates TWO `EmployeeAssignmentPeriod` rows — the old position up to the
 *     day before the transfer, the new one from the transfer date to year end.
 *  2. Attaches every existing KPI to period 1. Those KPIs were drafted by the
 *     OLD manager against the old department, so they are the old period's set
 *     by definition; leaving them unattached would let them be scored across a
 *     year the employee only spent half of.
 *  3. Moves `Employee.departmentId` / `entityId` / `managerId` to the new
 *     position, because §7.2's manager-of-record is whoever currently holds the
 *     relationship.
 *
 * Period 2 starts EMPTY. That is deliberate and is the whole of §12.3's "each
 * department's manager drafts … their own portion": the new manager writes their
 * own KPIs, they are not inherited. §5.3's exactly-100% then applies to each
 * period separately (`periodWeightageBlockedReason`).
 *
 * ## Why the old manager is snapshotted
 *
 * The period carries `managerEmployeeId`. Everywhere else in this system the
 * manager is resolved LIVE (§7.2), and that is right — but the split exists
 * precisely so the old manager keeps authority over the old half after the
 * employee has left their team, which a live lookup cannot express.
 *
 * ## What is NOT split
 *
 * §12.3 — "360 is done once at year-end (from wherever the employee sits then),
 * not duplicated." No 360 rows are touched here.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // §12.3 gives HR the consolidation, and a transfer rearranges two managers'
    // authority — not a line manager's call.
    // UX review P0 (US-2): a move's process is a JML mover case; recording the
    // split directly is an HR Super Admin correction with a stated reason.
    if (!isHrSuperAdmin(actor)) {
      return err(
        "Start a mover case in Joiners & leavers instead. Recording a transfer without the " +
          "mover process is an HR Super Admin correction.",
        403,
      );
    }

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = recordTransferSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const {
      employeeId,
      cycleId,
      transferDate,
      newDepartmentId,
      newManagerEmployeeId,
      bypassReason,
    } = parsed.data;

    const [employee, cycle] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          name: true,
          departmentId: true,
          entityId: true,
          managerId: true,
          roleTrack: true,
        },
      }),
      prisma.performanceCycle.findUnique({
        where: { id: cycleId },
        select: { id: true, year: true },
      }),
    ]);
    if (!employee) return notFound("Employee");
    if (!cycle) return notFound("Cycle");

    // §1.2 — entity is IMPLIED by department for everyone but C-Level, so it is
    // read from the department rather than accepted from the caller. Two fields
    // that must agree are two fields that can disagree.
    let newEntityId: string;
    if (newDepartmentId !== null) {
      const department = await prisma.department.findUnique({
        where: { id: newDepartmentId },
        select: { id: true, entityId: true },
      });
      if (!department) return notFound("Department");
      newEntityId = department.entityId;
    } else {
      const supplied = parsed.data.newEntityId;
      if (!supplied) {
        return err("newEntityId is required when the new position has no department.");
      }
      const entity = await prisma.orgEntity.findUnique({
        where: { id: supplied },
        select: { id: true },
      });
      if (!entity) return notFound("Entity");
      newEntityId = entity.id;
    }

    if (newDepartmentId === employee.departmentId && newEntityId === employee.entityId) {
      return err("This is not a transfer — the department and entity are unchanged.", 409);
    }

    // §2 — the cycle is the calendar performance year.
    const windows = splitWindows({
      cycleStart: new Date(Date.UTC(cycle.year, 0, 1)),
      cycleEnd: new Date(Date.UTC(cycle.year, 11, 31)),
      transferDate,
    });
    if (!windows) {
      return err(
        `A transfer on this date does not split ${cycle.year} — it falls outside the cycle.`,
        409,
      );
    }

    const participant = await prisma.cycleParticipant.findUnique({
      where: { cycleId_employeeId: { cycleId, employeeId } },
      select: { id: true },
    });
    if (!participant) {
      return err("This employee is not enrolled in that cycle.", 409);
    }

    const existingPeriods = await prisma.employeeAssignmentPeriod.count({
      where: { employeeId, cycleId },
    });
    if (existingPeriods > 0) {
      // A second transfer in one year is a real thing, and a real piece of work:
      // it needs three periods, a re-split of an already-split set, and a
      // decision about which period the middle KPIs belong to. Refusing it
      // plainly beats producing a two-period answer that silently loses a third
      // of the year.
      return err(
        "This employee's year is already split. A second mid-cycle transfer is not supported in v1 — record it with HR and split manually.",
        409,
      );
    }

    // The split itself is shared with the JML mover (lib/pms/transfer-apply.ts).
    const result = await auditedTransaction((tx) =>
      splitAndMove(tx, {
        employee,
        cycleId,
        participantId: participant.id,
        windows,
        transferDate,
        newDepartmentId,
        newEntityId,
        newManagerEmployeeId,
        note: `Recorded without the mover process: ${bypassReason}`,
      }),
    );

    return ok({
      employeeId,
      cycleId,
      transferDate,
      periods: [
        {
          id: result.beforeId,
          orderIndex: 0,
          startsOn: windows.before.startsOn,
          endsOn: windows.before.endsOn,
          days: periodDays(windows.before),
          weight: periodWeight(windows.before).toFixed(4),
          kpiCount: result.attached,
        },
        {
          id: result.afterId,
          orderIndex: 1,
          startsOn: windows.after.startsOn,
          endsOn: windows.after.endsOn,
          days: periodDays(windows.after),
          weight: periodWeight(windows.after).toFixed(4),
          kpiCount: 0,
        },
      ],
    });
  }),
  { id: "pms-transfer-write", limit: 20, windowMs: 60_000 },
);

/** The split, for the screen that shows each period's manager, days and weight. */
export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgWide) {
      return err("The transfer register is HR's and the executive viewers'.", 403);
    }

    const url = new URL(request.url);
    const cycleId = url.searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");
    const employeeId = url.searchParams.get("employeeId");

    const periods = await prisma.employeeAssignmentPeriod.findMany({
      where: { cycleId, ...(employeeId ? { employeeId } : {}) },
      take: 500,
      orderBy: [{ employeeId: "asc" }, { orderIndex: "asc" }],
      select: {
        id: true,
        orderIndex: true,
        startsOn: true,
        endsOn: true,
        employee: { select: { id: true, name: true, odooId: true } },
        department: { select: { id: true, name: true } },
        entity: { select: { id: true, name: true } },
        managerEmployee: { select: { id: true, name: true } },
        _count: { select: { kpis: true } },
      },
    });

    return ok({
      cycleId,
      periods: periods.map((p) => ({
        id: p.id,
        orderIndex: p.orderIndex,
        employeeId: p.employee.id,
        employeeName: p.employee.name,
        employeeNumber: p.employee.odooId,
        department: p.department?.name ?? null,
        entity: p.entity.name,
        manager: p.managerEmployee
          ? { id: p.managerEmployee.id, name: p.managerEmployee.name }
          : null,
        startsOn: p.startsOn,
        endsOn: p.endsOn,
        days: periodDays(p),
        // §12.3's "days-in-department ÷ 365", precomputed so the screen never
        // re-derives a number the score depends on.
        weight: periodWeight(p).toFixed(4),
        kpiCount: p._count.kpis,
      })),
    });
  }),
  { id: "pms-transfer-read", limit: 60, windowMs: 60_000 },
);
