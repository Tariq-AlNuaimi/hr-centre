import { prisma } from "@/lib/prisma";

/**
 * The employee context rail on a ticket (UX review tickets P1-3; ServiceNow's
 * HR agent workspace): who is asking — placement, manager, job, grade, how
 * long they have been here — whether a joiner / mover / leaver case is open
 * for them, and their last few questions. Read only when the ticket matched a
 * core Employee; Internal fields only (no pay, no IDs, no personal details).
 * Callers gate on reading the ticket itself and pass the viewer's reach, so
 * "recent questions" never shows a ticket from a pair the viewer cannot read.
 */
export async function ticketContext(
  ticket: { id: string; employeeId: string | null; employeeEmail: string },
  reach: "all" | string[],
) {
  const [employee, openCase, recent] = await Promise.all([
    ticket.employeeId
      ? prisma.employee.findUnique({
          where: { id: ticket.employeeId },
          select: {
            id: true,
            name: true,
            jobTitle: true,
            gradeRef: { select: { code: true } },
            dateOfJoining: true,
            status: true,
            entity: { select: { name: true } },
            department: { select: { name: true } },
            manager: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve(null),
    ticket.employeeId
      ? prisma.jmlCase.findFirst({
          where: {
            employeeId: ticket.employeeId,
            status: { in: ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] },
          },
          select: { caseType: true },
        })
      : Promise.resolve(null),
    prisma.escalation.findMany({
      where: {
        id: { not: ticket.id },
        ...(reach === "all" ? {} : { hrPairId: { in: reach } }),
        OR: [
          ...(ticket.employeeId ? [{ employeeId: ticket.employeeId }] : []),
          { employeeEmail: ticket.employeeEmail },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, ticketNumber: true, status: true, question: true, createdAt: true },
    }),
  ]);
  // ADR-103: the grade is the catalogue's code; the rail keeps its `grade` field.
  const person = employee
    ? (({ gradeRef, ...rest }) => ({ ...rest, grade: gradeRef?.code ?? null }))(employee)
    : null;
  return { employee: person, openCaseType: openCase?.caseType ?? null, recent };
}
