import { prisma } from "@/lib/prisma";

/**
 * The line manager's cross-module view of their team (UX review R14,
 * docs/blueprints/ux-p1-team.md): direct reports by status, joiners arriving,
 * movers and leavers in the team (JML cases in flight), and the hiring
 * requests they own. Keyed on the reporting line — a manager sees their OWN
 * reports' cases, with only the facts a manager acts on (who, which kind of
 * case, the key date), never the case's checklist, pay or exit details.
 * Bounded: one grouped count, ≤ 20 cases, one count.
 */

const IN_FLIGHT = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"] as const;
const OPEN_REQUISITION = ["DRAFT", "PENDING_APPROVAL", "OPEN", "ON_HOLD", "REOPENED"] as const;

export type TeamCase = {
  id: string;
  type: "JOIN" | "MOVE" | "LEAVE";
  employee: { id: string; name: string };
  keyDate: Date | null;
};

export async function teamOverview(viewer: { employeeId: string | null; userId: string }) {
  const managerId = viewer.employeeId;
  const [byStatus, cases, openRequisitions] = await Promise.all([
    managerId
      ? prisma.employee.groupBy({ by: ["status"], where: { managerId }, _count: { _all: true } })
      : Promise.resolve([]),
    managerId
      ? prisma.jmlCase.findMany({
          where: { employee: { managerId }, status: { in: [...IN_FLIGHT] } },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            caseType: true,
            employee: { select: { id: true, name: true } },
            joinDetail: { select: { plannedStartDate: true, actualStartDate: true } },
            moveDetail: { select: { effectiveDate: true } },
            leaveDetail: { select: { lastDayOfService: true } },
          },
        })
      : Promise.resolve([]),
    prisma.hiringRequisition.count({
      where: { hiringManagerId: viewer.userId, status: { in: [...OPEN_REQUISITION] } },
    }),
  ]);
  return {
    reports: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])) as Record<
      string,
      number
    >,
    cases: cases.map((c): TeamCase => ({
      id: c.id,
      type: c.caseType,
      employee: c.employee,
      keyDate:
        c.joinDetail?.actualStartDate ??
        c.joinDetail?.plannedStartDate ??
        c.moveDetail?.effectiveDate ??
        c.leaveDetail?.lastDayOfService ??
        null,
    })),
    openRequisitions,
  };
}
