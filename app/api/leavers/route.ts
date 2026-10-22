import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { rollUpTarget } from "@/lib/pms/roll-up";
import { departureReportsWhere, departureThreeSixtyWhere } from "@/lib/pms/departure";
import { revokeLoginOnOffboard } from "@/lib/pms/offboarding";
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
    // §4.1 — employee data administration is HR's.
    if (!isHr(actor)) return err("Only HR records a departure (§12.1).", 403);
    if (!actor.employeeId) {
      return err("This account has no linked employee record (ADR-065).", 403);
    }

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = markLeaverSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { employeeId, lastWorkingDay, note } = parsed.data;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, status: true, managerId: true, lastWorkingDay: true },
    });
    if (!employee) return notFound("Employee");
    if (employee.status === "LEAVER") {
      return err("This employee is already recorded as a leaver (§12.1).", 409);
    }

    // §12.1 — "one level (to the departed manager's own manager)". May be null,
    // and a null target is the case HR most needs the prompt for.
    const target = rollUpTarget(employee);

    // The SAME predicate the confirmation HR just read was built from
    // (lib/pms/departure.ts). Two hand-written queries answering "whose line
    // moves" is how a confirmation starts lying.
    const reports = await prisma.employee.findMany({
      where: departureReportsWhere(employeeId),
      take: 200,
      select: { id: true, name: true },
    });

    const rolled = await auditedTransaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: "LEAVER", lastWorkingDay },
      });

      // §12.1 preserves the RECORD; ADR-069 revokes the ACCESS. In the same
      // transaction as the status change, so a departure cannot half-happen —
      // rolled-up reports with a still-live login is the worst of both.
      const revokedUserId = await revokeLoginOnOffboard(tx, employeeId);

      const moved: string[] = [];
      for (const report of reports) {
        // The line MOVES: §7.2's manager-of-record is whoever currently holds
        // the relationship, and leaving it pointing at a leaver would hand the
        // sign-off to someone who has gone.
        await tx.employee.update({ where: { id: report.id }, data: { managerId: target } });

        // §12.2's prompt. `upsert` on the partial unique index would be the
        // natural shape, but Prisma cannot target a partial index — so the open
        // row is looked up explicitly. A report already carrying an open
        // roll-up (their previous manager left too) keeps the ORIGINAL row and
        // has its target updated: one unresolved line, one prompt.
        const open = await tx.managerRollUp.findFirst({
          where: { employeeId: report.id, resolvedAt: null },
          select: { id: true },
        });
        if (open) {
          await tx.managerRollUp.update({
            where: { id: open.id },
            data: { toManagerEmployeeId: target },
          });
        } else {
          await tx.managerRollUp.create({
            data: {
              employeeId: report.id,
              fromManagerEmployeeId: employeeId,
              toManagerEmployeeId: target,
              reason: "LEAVER_ROLLUP",
            },
          });
        }
        moved.push(report.id);
      }

      await recordAudit(tx, {
        entityType: "Employee",
        entityId: employeeId,
        action: "UPDATE",
        before: { status: employee.status, lastWorkingDay: employee.lastWorkingDay },
        after: {
          status: "LEAVER",
          lastWorkingDay,
          rolledUpReportCount: moved.length,
          rolledUpTo: target,
          // §12.2's trail has to say whether access was revoked. `false` is as
          // much a fact as `true`: most employees have no login yet, and "we
          // revoked nothing" is the answer to a question an auditor will ask.
          loginRevoked: revokedUserId !== null,
          note: note ?? null,
        },
      });

      return moved;
    });

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
    if (!isHr(actor)) return err("The reassignment queue is HR's (§12.1).", 403);

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
