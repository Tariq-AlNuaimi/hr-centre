import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { LeaveReportFilters } from "@/lib/validations/jml/report";
import { caseScopeWhere, holdsAnywhere, type JmlActor } from "../../access";
import type { Cell } from "./rules";

/**
 * Shared pieces of R1–R8 (HR Offboarding Module 16): the period on the LAST
 * DAY OF SERVICE, the standard filters, the actor's report scope, the row
 * shape. Capped at 5,000 rows with the cap reported. Migrated history counts
 * in attrition (R1–R5, R8) and never in process metrics (R6, R7, cycle time).
 */

export const REPORT_ROW_CAP = 5000;

export type LeaveReportContext = { actor: JmlActor; filters: LeaveReportFilters; now: Date };

export type LeaveReportResult = {
  columns: Array<{ key: string; title: string }>;
  cells: Cell[];
  summary: Array<{ label: string; value: string | number | null }>;
  unavailable: Array<{ measure: string; needs: string }>;
  totalRecords: number;
  migratedExcluded: number;
  capReached: boolean;
  suppressedCells: number;
};

export type LeaveReport = {
  slug: string;
  title: string;
  run: (ctx: LeaveReportContext) => Promise<LeaveReportResult>;
};

export function period(f: LeaveReportFilters, now: Date): { from: Date; to: Date } {
  if (f.exitMonth) {
    const [y, m] = f.exitMonth.split("-").map(Number) as [number, number];
    return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
  }
  const to = f.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from =
    f.from ?? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate() + 1));
  return { from, to };
}

export function unsuppressed(actor: JmlActor): boolean {
  return holdsAnywhere(actor, "jml.unsuppressedReports");
}

export const LEAVE_ROW_SELECT = {
  id: true,
  caseRef: true,
  status: true,
  stage: true,
  completionPct: true,
  closedAt: true,
  hrOwner: { select: { name: true } },
  employee: { select: { dateOfJoining: true } },
  leaveDetail: {
    select: {
      exitType: true,
      exitSubtype: true,
      nationality: true,
      employmentTypeAtExit: true,
      noticeStartDate: true,
      lastPhysicalWorkingDay: true,
      lastDayOfService: true,
      migrated: true,
      employeeNameAtExit: true,
      jobTitleAtExit: true,
      gradeAtExit: true,
      positionClassificationName: true,
      entityIdAtExit: true,
      directorateIdAtExit: true,
      departmentIdAtExit: true,
      lineManagerEmployeeId: true,
      lineManager: { select: { name: true } },
    },
  },
  interview: {
    select: {
      primaryL1: true,
      primaryL2Code: true,
      secondaryL2Code: true,
      regrettable: true,
      preventable: true,
      preventionFactor: true,
    },
  },
  settlement: {
    select: {
      approvedAt: true,
      paymentConfirmedAt: true,
      provisional: true,
      figuresEnc: true,
      calculatedAt: true,
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

export type LeaveRow = Prisma.JmlCaseGetPayload<{ select: typeof LEAVE_ROW_SELECT }> & {
  leaveDetail: NonNullable<
    Prisma.JmlCaseGetPayload<{ select: typeof LEAVE_ROW_SELECT }>["leaveDetail"]
  >;
};

export function leaveWhere(
  ctx: LeaveReportContext,
  extra: Prisma.JmlCaseWhereInput = {},
): Prisma.JmlCaseWhereInput {
  const f = ctx.filters;
  const { from, to } = period(f, ctx.now);
  const scope = caseScopeWhere(ctx.actor, "jml.viewReports") ?? { id: { in: [] } };
  const detail: Prisma.LeaveCaseDetailWhereInput = {
    lastDayOfService: { gte: from, lte: to },
    ...(f.entityId ? { entityIdAtExit: f.entityId } : {}),
    ...(f.directorateId ? { directorateIdAtExit: f.directorateId } : {}),
    ...(f.departmentId ? { departmentIdAtExit: f.departmentId } : {}),
    ...(f.exitType ? { exitType: f.exitType } : {}),
    ...(f.exitSubtype ? { exitSubtype: f.exitSubtype } : {}),
    ...(f.nationality ? { nationality: f.nationality } : {}),
    ...(f.employmentType ? { employmentTypeAtExit: f.employmentType } : {}),
  };
  return {
    AND: [
      scope,
      {
        caseType: "LEAVE",
        // A withdrawn exit (cancelled, later archived) is not an exit.
        cancelledAt: null,
        status: f.status ?? { notIn: ["DRAFT", "CANCELLED"] },
        ...(f.hrOwnerUserId ? { hrOwnerUserId: f.hrOwnerUserId } : {}),
        leaveDetail: detail,
      },
      extra,
    ],
  };
}

export async function loadLeaveRows(ctx: LeaveReportContext, extra: Prisma.JmlCaseWhereInput = {}) {
  const rows = (await prisma.jmlCase.findMany({
    where: leaveWhere(ctx, extra),
    select: LEAVE_ROW_SELECT,
    orderBy: { caseRef: "asc" },
    take: REPORT_ROW_CAP,
  })) as LeaveRow[];
  return { rows, capReached: rows.length >= REPORT_ROW_CAP };
}

export function emptyResult(): Omit<LeaveReportResult, "columns" | "cells"> {
  return {
    summary: [],
    unavailable: [],
    totalRecords: 0,
    migratedExcluded: 0,
    capReached: false,
    suppressedCells: 0,
  };
}

/** Org names for the ids a report shows, one query per level. */
export async function orgNames(rows: readonly LeaveRow[]) {
  const ids = (k: "entityIdAtExit" | "directorateIdAtExit" | "departmentIdAtExit") => [
    ...new Set(rows.map((r) => r.leaveDetail[k]).filter((x): x is string => Boolean(x))),
  ];
  const [e, dr, dp] = await Promise.all([
    prisma.orgEntity.findMany({
      where: { id: { in: ids("entityIdAtExit") } },
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.directorate.findMany({
      where: { id: { in: ids("directorateIdAtExit") } },
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.department.findMany({
      where: { id: { in: ids("departmentIdAtExit") } },
      select: { id: true, name: true },
      take: 2000,
    }),
  ]);
  const m = (xs: { id: string; name: string }[]) => new Map(xs.map((x) => [x.id, x.name]));
  return { entity: m(e), directorate: m(dr), department: m(dp) };
}
