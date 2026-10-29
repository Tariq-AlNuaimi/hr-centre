import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { isHr, isHrSuperAdmin } from "@/lib/core/permissions";
import {
  DEPARTURE_REPORTS_LIMIT,
  applyDeparture,
  departureThreeSixtyWhere,
} from "@/lib/pms/departure";
import { markLeaverSchema } from "@/lib/validations/edge-cases";

/**
 * §12.1 — a departure, and everything that has to close out behind it.
 *
 * "Status = Leaver + last working day, settable by import or MANUALLY (immediate
 * one-off resignations)." This route is the manual half; the import layer is the
 * other, and both land on the same two columns.
 *
 * Four consequences, all in ONE transaction:
 *
 *  1. **Status and last working day.** §11.4 pro-rates from cycle start to that
 *     date, so it is not optional here (see `markLeaverSchema`).
 *  2. **The record is preserved.** Never a delete — §12.1 says so outright, and
 *     `lib/prisma/recyclable.ts` already excludes Employee from the bin for it.
 *  3. **Direct reports roll up ONE level**, to the departed manager's own
 *     manager, with a `ManagerRollUp` row per report so §12.2's prompt exists.
 *  4. **Pending actions close out.** The sweep already skips leavers
 *     (`isLadderExempt`), so no reminder or escalation fires after this — no
 *     code here, and that is the point: the close-out is a property of the
 *     status, not a list of things to remember to switch off.
 *
 * One transaction because a departure that moved the reports but did not record
 * the prompt leaves the org chart silently rearranged, which is precisely what
 * §12.2 exists to prevent.
 *
 * The 360 reassignment flag (§12.1's fourth bullet) is NOT written here — it is
 * derived, by GET below, from assignments where the leaver is an unfinished
 * rater. A stored flag would go stale the moment HR reassigned one.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // UX review P0 (US-2): a departure's process is a JML leaver case. Recording
    // it here skips the exit checklist, approvals and settlement, so it is an
    // admin correction — HR Super Admin only, with a stated reason.
    if (!isHrSuperAdmin(actor)) {
      return err(
        "Start a leaver case in Joiners & leavers instead. Recording a departure without the " +
          "exit process is an HR Super Admin correction.",
        403,
      );
    }
    if (!actor.employeeId) {
      return err("This account has no linked employee record (ADR-065).", 403);
    }

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = markLeaverSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { employeeId, lastWorkingDay, note, bypassReason } = parsed.data;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, status: true, managerId: true, lastWorkingDay: true },
    });
    if (!employee) return notFound("Employee");
    if (employee.status === "LEAVER") {
      return err("This employee is already recorded as a leaver.", 409);
    }

    // §12.1 — "one level (to the departed manager's own manager)". May be null,
    // and a null target is the case HR most needs the prompt for.
    // §12.1's departure, performed by the ONE writer both this route and the
    // import call (`lib/pms/departure.ts`). It used to live inline here, which
    // is why the import — the system of record for status under §3.2 — could
    // set a status and revoke a login while leaving the whole team pointing at
    // someone who had gone.
    const outcome = await auditedTransaction((tx) =>
      applyDeparture(tx, {
        employeeId,
        lastWorkingDay,
        previousStatus: employee.status,
        previousLastWorkingDay: employee.lastWorkingDay,
        // The reason lands on the departure's audit row.
        note: `Recorded without the exit process: ${bypassReason}${note ? ` — ${note}` : ""}`,
      }),
    );

    if (!outcome.ok) {
      if (outcome.reason === "TOO_MANY_REPORTS") {
        // Refused, not truncated. The old code read 200 and moved 200, leaving
        // any remainder on a departed manager with no prompt row — a silent
        // half-departure at exactly the scale nobody checks by hand.
        return err(
          `${employee.name} has ${outcome.reportCount} direct reports, which is more than this ` +
            `action moves in one step (${DEPARTURE_REPORTS_LIMIT}). Move some of them to another ` +
            `manager first, then record the departure.`,
          422,
        );
      }
      return err("This employee is already recorded as a leaver.", 409);
    }
    const target = outcome.rollUpTo;
    const rolled = outcome.movedReportIds;

    // §12.1 — "360 assignments where the leaver was a rater are flagged to HR
    // for reassignment (ratee must still reach 3 assessments)." Returned with
    // the departure so HR sees the work in the same breath as the event that
    // created it, rather than discovering it at launch.
    const orphaned = await prisma.assignment.findMany({
      where: departureThreeSixtyWhere(employeeId),
      take: 200,
      select: {
        id: true,
        status: true,
        ratee: { select: { id: true, name: true } },
        threeSixtyCycleId: true,
      },
    });

    return ok({
      employeeId,
      status: "LEAVER",
      lastWorkingDay,
      rolledUpReports: rolled.length,
      rolledUpTo: target,
      threeSixtyReassignmentsNeeded: orphaned.map((r) => ({
        assignmentId: r.id,
        status: r.status,
        rateeId: r.ratee.id,
        rateeName: r.ratee.name,
        threeSixtyCycleId: r.threeSixtyCycleId,
      })),
    });
  }),
  { id: "pms-leaver-write", limit: 30, windowMs: 60_000 },
);

/**
 * §12.1's flag as a standing HR queue — every unfinished assignment whose rater
 * has left, across the whole population.
 *
 * Needed because a departure recorded through the IMPORT (§12.1 allows both
 * paths) never passes through the POST above, and the reassignment work still
 * has to surface somewhere HR looks. Submitted assignments are excluded: the
 * ratee already has that assessment, and §9.4's "exactly 3" is satisfied by the
 * answers, not by the answerer still being employed.
 */
export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("The reassignment queue is HR's.", 403);

    const rows = await prisma.assignment.findMany({
      where: { status: { not: "SUBMITTED" }, rater: { status: "LEAVER" } },
      take: 500,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        rater: { select: { id: true, name: true, lastWorkingDay: true } },
        ratee: { select: { id: true, name: true } },
        threeSixtyCycle: { select: { id: true, status: true, cycleId: true } },
      },
    });

    return ok({
      reassignments: rows.map((r) => ({
        assignmentId: r.id,
        status: r.status,
        raterId: r.rater.id,
        raterName: r.rater.name,
        raterLastWorkingDay: r.rater.lastWorkingDay,
        rateeId: r.ratee.id,
        rateeName: r.ratee.name,
        threeSixtyCycleId: r.threeSixtyCycle.id,
        threeSixtyStatus: r.threeSixtyCycle.status,
      })),
    });
  }),
  { id: "pms-leaver-read", limit: 60, windowMs: 60_000 },
);
