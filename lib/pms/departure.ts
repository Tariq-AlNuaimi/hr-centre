import type { Prisma } from "@/generated/prisma/client";
import { prisma, type auditedTransaction } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { revokeLoginOnOffboard } from "./offboarding";
import { rollUpTarget } from "./roll-up";

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/**
 * §12.1's departure, defined once.
 *
 * The consequences of recording a leaver are spread across three callers — the
 * `/api/leavers` write, the confirmation HR reads before pressing it, and the
 * standing reassignment queue — and the first two MUST agree. A confirmation
 * that says "3 reports will move" and a write that moves 4 is worse than no
 * confirmation at all: it teaches the reader to stop reading it.
 *
 * So the two `where` clauses live here and nowhere else. This is the same
 * discipline as `YEAR_END_KPI_SELECT`: the §6.2 defect this repo keeps
 * producing is two call sites answering one question with their own hand-written
 * query, and the only durable fix is that there is one query.
 */

/**
 * Whose line moves — §12.1's "direct reports roll up one level".
 *
 * Excludes leavers (their own line already closed out) and soft-deleted rows
 * (erroneous records, which are not people who report to anyone).
 */
export function departureReportsWhere(employeeId: string): Prisma.EmployeeWhereInput {
  return { managerId: employeeId, deletedAt: null, status: { not: "LEAVER" } };
}

/**
 * How many reports one departure moves — and the order, which matters as much.
 *
 * Shared because the predicate alone was not enough to stop the confirmation
 * lying. The preview read 200 reports ordered by name while the write read 200
 * in whatever order Postgres returned, so a manager with more than 200 reports
 * got a confirmation naming one arbitrary 200 and a write moving a DIFFERENT
 * arbitrary 200, with the remainder left pointing at someone who had gone and
 * no prompt row to say so. Same `where`, different `take`/`orderBy`, same
 * class of defect.
 *
 * Above the limit the departure is REFUSED rather than silently truncated.
 * 200 direct reports is not a real reporting line, so the refusal is
 * effectively unreachable; what matters is that exceeding it cannot be quiet.
 */
export const DEPARTURE_REPORTS_LIMIT = 200;
const DEPARTURE_REPORTS_ORDER = { name: "asc" } as const;

/**
 * Which 360 assignments need a new rater — §12.1's fourth bullet.
 *
 * SUBMITTED is excluded deliberately: the ratee already has that assessment,
 * and §9.4's "exactly 3" is satisfied by the answers, not by the answerer still
 * being employed. Never stored as a flag — a stored one goes stale the moment
 * HR reassigns, which is why this is a query and not a column.
 */
export function departureThreeSixtyWhere(employeeId: string): Prisma.AssignmentWhereInput {
  return { raterId: employeeId, status: { not: "SUBMITTED" } };
}

export interface DeparturePreview {
  /** Null when they are already a leaver — nothing to preview. */
  alreadyLeaver: boolean;
  /** §12.1's target: the departing manager's own manager. Null at the top. */
  rollUpToId: string | null;
  rollUpToName: string | null;
  /** The reports whose line moves, named so the confirmation can list them. */
  reports: { id: string; name: string }[];
  /** The assignments HR will have to reassign. */
  threeSixty: { assignmentId: string; rateeName: string }[];
  /** Whether a login will be revoked, so the confirmation can say so. */
  hasLogin: boolean;
}

/**
 * What recording this departure will do, read BEFORE it is done.
 *
 * Returns the same sets the write will act on, from the same predicates. The
 * numbers can still move between the preview and the press — somebody else may
 * reassign a rater in between — and that is acceptable: the write re-reads
 * them. What must not happen is the two DISAGREEING about what counts.
 */
export async function departurePreview(employeeId: string): Promise<DeparturePreview | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, status: true, managerId: true, userId: true },
  });
  if (!employee) return null;

  const rollUpToId = rollUpTarget(employee);

  const [rollUpTo, reports, threeSixty] = await Promise.all([
    rollUpToId
      ? prisma.employee.findUnique({ where: { id: rollUpToId }, select: { name: true } })
      : Promise.resolve(null),
    prisma.employee.findMany({
      where: departureReportsWhere(employeeId),
      take: DEPARTURE_REPORTS_LIMIT,
      orderBy: DEPARTURE_REPORTS_ORDER,
      select: { id: true, name: true },
    }),
    prisma.assignment.findMany({
      where: departureThreeSixtyWhere(employeeId),
      take: DEPARTURE_REPORTS_LIMIT,
      select: { id: true, ratee: { select: { name: true } } },
    }),
  ]);

  return {
    alreadyLeaver: employee.status === "LEAVER",
    rollUpToId,
    rollUpToName: rollUpTo?.name ?? null,
    reports,
    threeSixty: threeSixty.map((a) => ({ assignmentId: a.id, rateeName: a.ratee.name })),
    hasLogin: employee.userId !== null,
  };
}

/** What a departure did, or why it did nothing. */
export type DepartureOutcome =
  | {
      ok: true;
      /** The reports whose line moved. */
      movedReportIds: string[];
      /** §12.1's target the lines moved to. Null when the leaver was at the top. */
      rollUpTo: string | null;
      /** Whether an account was actually revoked — `false` is as much a fact as `true`. */
      loginRevoked: boolean;
    }
  | { ok: false; reason: "TOO_MANY_REPORTS"; reportCount: number }
  | { ok: false; reason: "ALREADY_LEAVER" };

/**
 * §12.1's departure, performed. THE ONLY WRITER.
 *
 * ## Why this is a function and not a route handler
 *
 * It was a route handler, and that was the defect. `POST /api/leavers` did all
 * four parts of a departure — the status, the roll-up, §12.2's prompt row, the
 * revoked login — while the IMPORT, which §3.2 makes the system of record for
 * status, did two of them: it set the status and revoked the login and left
 * every direct report pointing at a manager who had gone, with no prompt row
 * to say so and nothing anywhere that surfaces "active people whose manager is
 * a leaver". An org that off-boards by spreadsheet — the normal case, and the
 * one this build is actually used for — got a silently broken reporting line
 * every time.
 *
 * Guarding the hand-edit route (`PUT /api/employees/[id]` refuses the
 * transition outright) did not touch that, because the import never went
 * through it. "One writer" is only true if the writer is something both
 * callers can call, so here it is.
 *
 * ## The caller supplies the transaction
 *
 * Every part of a departure has to commit together or not at all: a rolled-up
 * report beside a live login is the worst of the possible halves. The import
 * already wraps its whole apply in one `auditedTransaction` with a raised
 * budget, so this takes the `tx` rather than opening its own — nesting would
 * give the roll-up a commit boundary of its own.
 *
 * ## Ordering, for the import
 *
 * The import must call this AFTER its manager-edge pass, not during the row
 * loop. Pass 2 writes `managerId` from the sheet, so a roll-up performed first
 * would be overwritten by a stale sheet that still lists the departed manager.
 * Running last also makes the re-query correct by construction: a report whose
 * line the sheet legitimately moved elsewhere is no longer matched by
 * `departureReportsWhere`, so it is left alone.
 */
export async function applyDeparture(
  tx: Tx,
  params: {
    employeeId: string;
    lastWorkingDay: Date;
    /** For the audit row's `before`. */
    previousStatus: string;
    previousLastWorkingDay: Date | null;
    note?: string | null;
  },
): Promise<DepartureOutcome> {
  const { employeeId, lastWorkingDay, previousStatus, previousLastWorkingDay, note } = params;

  if (previousStatus === "LEAVER") return { ok: false, reason: "ALREADY_LEAVER" };

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, managerId: true },
  });
  if (!employee) return { ok: false, reason: "ALREADY_LEAVER" };

  const target = rollUpTarget(employee);

  // Counted BEFORE anything is written, so an over-limit departure leaves no
  // half-written state behind for the caller to undo.
  const reportCount = await tx.employee.count({ where: departureReportsWhere(employeeId) });
  if (reportCount > DEPARTURE_REPORTS_LIMIT) {
    return { ok: false, reason: "TOO_MANY_REPORTS", reportCount };
  }

  const reports = await tx.employee.findMany({
    where: departureReportsWhere(employeeId),
    take: DEPARTURE_REPORTS_LIMIT,
    orderBy: DEPARTURE_REPORTS_ORDER,
    select: { id: true },
  });

  await tx.employee.update({
    where: { id: employeeId },
    data: { status: "LEAVER", lastWorkingDay },
  });

  // §12.1 preserves the RECORD; ADR-069 revokes the ACCESS. Idempotent, so a
  // caller that already revoked (a re-imported sheet still listing last year's
  // leaver) gets a no-op rather than a second audit row.
  const revokedUserId = await revokeLoginOnOffboard(tx, employeeId);

  const moved: string[] = [];
  for (const report of reports) {
    // The line MOVES: §7.2's manager-of-record is whoever currently holds the
    // relationship, and leaving it on a leaver hands the sign-off to someone
    // who has gone.
    await tx.employee.update({ where: { id: report.id }, data: { managerId: target } });

    // §12.2's prompt. `upsert` on the partial unique index would be the natural
    // shape, but Prisma cannot target a partial index — so the open row is
    // looked up explicitly. A report already carrying an open roll-up (their
    // previous manager left too) keeps the ORIGINAL row and has its target
    // updated: one unresolved line, one prompt.
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
    before: { status: previousStatus, lastWorkingDay: previousLastWorkingDay },
    after: {
      status: "LEAVER",
      lastWorkingDay,
      rolledUpReportCount: moved.length,
      rolledUpTo: target,
      // §12.2's trail has to say whether access was revoked. `false` is as much
      // a fact as `true`: most employees have no login yet, and "we revoked
      // nothing" is the answer to a question an auditor will ask.
      loginRevoked: revokedUserId !== null,
      note: note ?? null,
    },
  });

  return {
    ok: true,
    movedReportIds: moved,
    rollUpTo: target,
    loginRevoked: revokedUserId !== null,
  };
}

/** What undoing a departure did. */
export type ReverseDepartureOutcome =
  | {
      ok: true;
      /** Whether a revoked login was restored. */
      loginRestored: boolean;
      /**
       * The reports §12.1's roll-up moved away from this person whose roll-up is
       * still OPEN — the lines HR may want to move back. Not moved automatically:
       * a report's line may since have been decided on purpose.
       */
      rolledUpReportIds: string[];
    }
  | { ok: false; reason: "NOT_A_LEAVER" };

/**
 * JML S1 (ADR-080) — undo a departure when a resignation is withdrawn
 * (Offboarding T10). The inverse of `applyDeparture`, and like it the caller
 * supplies the transaction:
 *
 *  - status back to ACTIVE and `lastWorkingDay` cleared;
 *  - the login revoked by `revokeLoginOnOffboard` restored (its soft delete
 *    undone — the account, its links and its audit history are the same row);
 *  - reporting lines are NOT moved back: the open roll-up prompts are returned
 *    so HR can decide each one (a report may have been re-lined on purpose).
 *
 * One audit row records the reversal beside the departure it reverses.
 */
export async function reverseDeparture(
  tx: Tx,
  params: { employeeId: string; note?: string | null },
): Promise<ReverseDepartureOutcome> {
  const employee = await tx.employee.findUnique({
    where: { id: params.employeeId },
    select: { id: true, status: true, lastWorkingDay: true, userId: true },
  });
  if (!employee || employee.status !== "LEAVER") return { ok: false, reason: "NOT_A_LEAVER" };

  await tx.employee.update({
    where: { id: employee.id },
    data: { status: "ACTIVE", lastWorkingDay: null },
  });

  let loginRestored = false;
  if (employee.userId) {
    const revoked = await tx.user.findFirst({
      where: { id: employee.userId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (revoked) {
      await tx.user.update({
        where: { id: revoked.id },
        data: { deletedAt: null, deletedBy: null },
        select: { id: true },
      });
      loginRestored = true;
    }
  }

  const openRollUps = await tx.managerRollUp.findMany({
    where: { fromManagerEmployeeId: employee.id, resolvedAt: null, reason: "LEAVER_ROLLUP" },
    select: { employeeId: true },
    take: DEPARTURE_REPORTS_LIMIT,
  });

  await recordAudit(tx, {
    entityType: "Employee",
    entityId: employee.id,
    action: "UPDATE",
    before: { status: "LEAVER", lastWorkingDay: employee.lastWorkingDay },
    after: {
      status: "ACTIVE",
      lastWorkingDay: null,
      departureReversed: true,
      loginRestored,
      openRollUps: openRollUps.length,
      note: params.note ?? null,
    },
  });

  return { ok: true, loginRestored, rolledUpReportIds: openRollUps.map((r) => r.employeeId) };
}
