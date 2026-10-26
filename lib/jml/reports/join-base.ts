import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSalary } from "@/lib/pms/employee-select";
import type { ReportFilters } from "@/lib/validations/jml/report";
import { canFor, caseScopeWhere, subjectOf, type JmlActor } from "../access";

/**
 * Shared pieces of the eight onboarding reports (HR Onboarding `reports.ts`,
 * §13): the standard filters as a Prisma filter, the case row, the column
 * helpers. Every query is AND-ed with the actor's report scope, so a
 * company-scoped officer reports on their company only (8.4.1 fixed: reports
 * are a permission, checked by the route AND the page).
 */

export type ReportRow = Record<string, string | number | boolean | null>;

export type ReportColumn = { title: string; key: string; width?: number };

export type ReportContext = { actor: JmlActor; filters: ReportFilters; now: Date };

export type ReportDefinition = {
  slug: string;
  salaryCapable: boolean;
  run: (ctx: ReportContext) => Promise<ReportRow[]>;
  columns: (includeSalary: boolean) => ReportColumn[];
};

export const ROW_LIMIT = 5000;

export const col = (title: string, key: string, width = 20): ReportColumn => ({
  title,
  key,
  width,
});

export function monthRange(month: string): { gte: Date; lt: Date } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return { gte: new Date(Date.UTC(year, mon - 1, 1)), lt: new Date(Date.UTC(year, mon, 1)) };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function employeeWhere(f: ReportFilters): Prisma.EmployeeWhereInput {
  return {
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.directorateId ? { department: { directorateId: f.directorateId } } : {}),
    ...(f.employmentType ? { contractType: f.employmentType } : {}),
    ...(f.nationality ? { nationality: { equals: f.nationality, mode: "insensitive" } } : {}),
    ...(f.workLocation ? { workLocation: { equals: f.workLocation, mode: "insensitive" } } : {}),
  };
}

/** JOIN cases matching the standard filters, inside the actor's report scope. */
export function joinWhere(ctx: ReportContext, extra: Prisma.JmlCaseWhereInput = {}) {
  const f = ctx.filters;
  const scope = caseScopeWhere(ctx.actor, "jml.viewReports") ?? { id: { in: [] } };
  const detail: Prisma.JmlJoinDetailWhereInput = {
    ...(f.contractTypeId ? { contractTypeId: f.contractTypeId } : {}),
    ...(f.joiningMonth ? { plannedStartDate: monthRange(f.joiningMonth) } : {}),
  };
  const activated =
    f.from || f.to
      ? { activatedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {};
  return {
    AND: [
      scope,
      {
        caseType: "JOIN" as const,
        ...(f.status ? { status: f.status } : {}),
        ...(f.stage ? { stage: f.stage } : {}),
        ...(f.hrOwnerUserId ? { hrOwnerUserId: f.hrOwnerUserId } : {}),
        ...activated,
        employee: employeeWhere(f),
        ...(Object.keys(detail).length ? { joinDetail: detail } : {}),
      },
      extra,
    ],
  } satisfies Prisma.JmlCaseWhereInput;
}

export const CASE_SELECT = {
  caseRef: true,
  stage: true,
  status: true,
  completionPct: true,
  activatedAt: true,
  completedAt: true,
  hrOwner: { select: { name: true } },
  joinDetail: { select: { plannedStartDate: true, actualStartDate: true } },
  employee: {
    select: {
      name: true,
      odooId: true,
      employeeCode: true,
      jobTitle: true,
      contractType: true,
      nationality: true,
      workLocation: true,
      basicSalaryEnc: true,
      entityId: true,
      departmentId: true,
      entity: { select: { name: true } },
      department: { select: { name: true, directorateId: true } },
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

type CaseShape = Prisma.JmlCaseGetPayload<{ select: typeof CASE_SELECT }>;

/** One case as a report row; salary only when asked AND permitted for that person. */
export function caseRow(r: CaseShape, ctx: ReportContext, withSalary: boolean): ReportRow {
  const e = r.employee;
  const row: ReportRow = {
    caseRef: r.caseRef,
    fullName: e.name,
    employeeCode: e.employeeCode,
    jobTitle: e.jobTitle,
    employmentType: e.contractType,
    nationality: e.nationality,
    workLocation: e.workLocation,
    company: e.entity.name,
    department: e.department?.name ?? null,
    owner: r.hrOwner?.name ?? null,
    stage: r.stage,
    status: r.status,
    completionPct: r.completionPct,
    plannedStartDate: day(r.joinDetail?.plannedStartDate),
    actualStartDate: day(r.joinDetail?.actualStartDate),
    activatedAt: day(r.activatedAt),
    completedAt: day(r.completedAt),
  };
  if (withSalary) {
    const subject = subjectOf({
      entityId: e.entityId,
      departmentId: e.departmentId,
      department: e.department ? { directorateId: e.department.directorateId } : null,
    });
    row.salary = canFor(ctx.actor, "people.viewSalary", subject)
      ? decryptSalary(e.basicSalaryEnc, e.odooId)
      : null;
  }
  return row;
}

export async function runCaseReport(
  ctx: ReportContext,
  salaryCapable: boolean,
  extra: Prisma.JmlCaseWhereInput = {},
): Promise<ReportRow[]> {
  const rows = await prisma.jmlCase.findMany({
    where: joinWhere(ctx, extra),
    select: CASE_SELECT,
    orderBy: { createdAt: "desc" },
    take: ROW_LIMIT,
  });
  const withSalary = salaryCapable && ctx.filters.includeSalary;
  return rows.map((r) => caseRow(r, ctx, withSalary));
}

export const CASE_IDENTITY: ReportColumn[] = [
  col("Case", "caseRef", 18),
  col("Employee", "fullName", 26),
  col("Employee code", "employeeCode", 14),
  col("Company", "company", 18),
  col("Department", "department", 20),
  col("HR owner", "owner", 20),
];

/** Go-live = the first activated onboarding (trend starts there). */
export async function goLiveDate(): Promise<Date | null> {
  const first = await prisma.jmlCase.findFirst({
    where: { caseType: "JOIN", activatedAt: { not: null } },
    orderBy: { activatedAt: "asc" },
    select: { activatedAt: true },
  });
  return first?.activatedAt ?? null;
}
