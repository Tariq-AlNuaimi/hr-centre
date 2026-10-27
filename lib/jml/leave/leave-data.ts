import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { JmlError } from "../errors";

/** The leaver view of a case — header + detail + the employee as they are now. */

const LEAVE_SELECT = {
  id: true,
  caseRef: true,
  caseType: true,
  status: true,
  stage: true,
  version: true,
  ragFlag: true,
  completionPct: true,
  employeeId: true,
  hrOwnerUserId: true,
  seniorHrUserId: true,
  activatedAt: true,
  cancelReason: true,
  leaveDetail: true,
  employee: {
    select: {
      id: true,
      name: true,
      status: true,
      userId: true,
      dateOfJoining: true,
      entityId: true,
      departmentId: true,
      department: { select: { directorateId: true } },
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

export type LeaveRow = Prisma.JmlCaseGetPayload<{ select: typeof LEAVE_SELECT }>;
export type LeaveDetail = NonNullable<LeaveRow["leaveDetail"]>;

export async function loadLeaveRow(
  caseId: string,
): Promise<LeaveRow & { leaveDetail: LeaveDetail }> {
  const row = await prisma.jmlCase.findUnique({ where: { id: caseId }, select: LEAVE_SELECT });
  if (!row || row.caseType !== "LEAVE" || !row.leaveDetail)
    throw new JmlError("Case not found", 404);
  return row as LeaveRow & { leaveDetail: LeaveDetail };
}

/** The anchors every leaver task and register item is due from (§6.2). */
export function leaveAnchors(d: {
  noticeStartDate: Date;
  lastPhysicalWorkingDay: Date | null;
  lastDayOfService: Date | null;
  departureDate: Date | null;
}) {
  return {
    NOTICE_START: d.noticeStartDate,
    LAST_PHYSICAL_WORKING_DAY: d.lastPhysicalWorkingDay,
    LAST_DAY_OF_SERVICE: d.lastDayOfService,
    DEPARTURE_DATE: d.departureDate,
  };
}

/** Access revocation and asset return are keyed to the LPWD — the decision date for a summary dismissal. */
export function revocationAnchor(d: {
  exitType: string;
  noticeStartDate: Date;
  lastPhysicalWorkingDay: Date | null;
}): Date | null {
  return d.exitType === "SUMMARY_DISMISSAL" ? d.noticeStartDate : d.lastPhysicalWorkingDay;
}
