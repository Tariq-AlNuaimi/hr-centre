import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { rollUpTarget } from "./roll-up";

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
      take: 200,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.assignment.findMany({
      where: departureThreeSixtyWhere(employeeId),
      take: 200,
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
