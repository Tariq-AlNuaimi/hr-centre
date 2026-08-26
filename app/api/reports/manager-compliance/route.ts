import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";

/**
 * §13.5 — "Manager compliance report — deadline misses & escalations per
 * manager, for top management (§5.6)."
 *
 * §5.6 fixes the four facts each row must carry: "manager name, what was missed,
 * by how long, whether it required skip-level or HR intervention." All four are
 * already columns on `ComplianceEvent`, written by the nightly sweep — this
 * report is a re-shaping, never a re-derivation. §5.6 says the log is written
 * "automatically", and a report that recomputed misses from today's clock would
 * quietly change history every time it was opened.
 *
 * ## Grouped BY MANAGER, not by employee
 *
 * Appendix A: "Responsibility for a missed deadline falls on whoever controlled
 * that action; an employee is never disadvantaged by a manager's inaction." So
 * the unit of this report is the manager, and events whose `managerEmployeeId`
 * is null — the employee's own missed signature (§5.4) — are excluded from every
 * manager's tally. They are returned separately, so nothing is lost, but they
 * never land on someone else's accountability record.
 */

const ESCALATION_KINDS = new Set(["ESCALATED_SKIP_LEVEL", "ESCALATED_HR"]);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // §13.5 says "for top management". HR compiles it; the COO and Ops Director
    // read it (§4.1). A line manager does not see peers' compliance records.
    if (!actor.capabilities.orgWide) {
      return err("The manager compliance report is for HR and top management (§13.5).", 403);
    }

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      select: { id: true, year: true },
    });
    if (!cycle) return notFound("Cycle");

    const events = await prisma.complianceEvent.findMany({
      where: { cycleId },
      take: 4000,
      orderBy: { occurredAt: "asc" },
      select: {
        stageKind: true,
        kind: true,
        missedByHours: true,
        detail: true,
        occurredAt: true,
        subjectEmployee: { select: { id: true, name: true, odooId: true } },
        managerEmployee: {
          select: { id: true, name: true, odooId: true, department: { select: { name: true } } },
        },
      },
    });

    const byManager = new Map<
      string,
      {
        managerId: string;
        managerName: string;
        managerNumber: string;
        department: string | null;
        misses: number;
        escalations: number;
        hrInterventions: number;
        worstOverdueHours: number;
        affectedEmployees: Set<string>;
        events: Array<{
          stageKind: string;
          kind: string;
          missedByHours: number | null;
          detail: string;
          occurredAt: Date;
          subjectName: string;
        }>;
      }
    >();
    const employeeOwnMisses: Array<{ name: string; kind: string; occurredAt: Date }> = [];

    for (const e of events) {
      if (!e.managerEmployee) {
        // §5.4's "Employee did not sign" — the employee controlled it, so it is
        // recorded but belongs to nobody's manager record.
        if (e.kind === "DEADLINE_MISSED") {
          employeeOwnMisses.push({
            name: e.subjectEmployee.name,
            kind: e.kind,
            occurredAt: e.occurredAt,
          });
        }
        continue;
      }
      const m = e.managerEmployee;
      let row = byManager.get(m.id);
      if (!row) {
        row = {
          managerId: m.id,
          managerName: m.name,
          managerNumber: m.odooId,
          department: m.department?.name ?? null,
          misses: 0,
          escalations: 0,
          hrInterventions: 0,
          worstOverdueHours: 0,
          affectedEmployees: new Set<string>(),
          events: [],
        };
        byManager.set(m.id, row);
      }
      // A REMINDER is not a miss — §5.5's first rung fires BEFORE the deadline,
      // and counting it would make a manager who was warned and then acted look
      // identical to one who did not.
      if (e.kind === "DEADLINE_MISSED") {
        row.misses += 1;
        row.affectedEmployees.add(e.subjectEmployee.id);
      }
      if (ESCALATION_KINDS.has(e.kind)) row.escalations += 1;
      if (e.kind === "HR_EXTENDED_DEADLINE" || e.kind === "HR_MARKED_NON_COMPLIANT") {
        row.hrInterventions += 1;
      }
      if (e.missedByHours !== null && e.missedByHours > row.worstOverdueHours) {
        row.worstOverdueHours = e.missedByHours;
      }
      row.events.push({
        stageKind: e.stageKind,
        kind: e.kind,
        missedByHours: e.missedByHours,
        detail: e.detail,
        occurredAt: e.occurredAt,
        subjectName: e.subjectEmployee.name,
      });
    }

    const managers = [...byManager.values()]
      .map((m) => ({
        managerId: m.managerId,
        managerName: m.managerName,
        managerNumber: m.managerNumber,
        department: m.department,
        misses: m.misses,
        escalations: m.escalations,
        hrInterventions: m.hrInterventions,
        worstOverdueHours: m.worstOverdueHours,
        affectedEmployeeCount: m.affectedEmployees.size,
        events: m.events,
      }))
      // Worst record first — a top-management report is read from the top, and
      // the name that needs a conversation should be the first one on it.
      .sort(
        (a, b) =>
          b.misses - a.misses ||
          b.escalations - a.escalations ||
          b.worstOverdueHours - a.worstOverdueHours ||
          a.managerName.localeCompare(b.managerName),
      );

    return ok({
      cycleId,
      year: cycle.year,
      managers,
      // Recorded, and deliberately kept off every manager's tally.
      employeeOwnMisses,
      totals: {
        managersWithMisses: managers.filter((m) => m.misses > 0).length,
        totalMisses: managers.reduce((n, m) => n + m.misses, 0),
        totalEscalations: managers.reduce((n, m) => n + m.escalations, 0),
      },
    });
  }),
  { id: "pms-report-compliance", limit: 60, windowMs: 60_000 },
);
