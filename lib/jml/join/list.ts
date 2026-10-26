import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PaginationParams } from "@/lib/pagination";
import { caseScopeWhere, type JmlActor } from "../access";

/** The joiners list (Onboarding `/new-hires`): drafts and activated, never salary. */

export type JoinerListFilter = {
  search?: string;
  status: "all" | "draft" | "active";
  entityId?: string;
  departmentId?: string;
  employmentType?: string;
};

export async function listJoiners(
  actor: JmlActor,
  filter: JoinerListFilter,
  page: PaginationParams,
) {
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return { rows: [], total: 0 };
  const employee: Prisma.EmployeeWhereInput = {
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
    ...(filter.employmentType
      ? { contractType: filter.employmentType as Prisma.EmployeeWhereInput["contractType"] }
      : {}),
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: "insensitive" } },
            { employeeCode: { contains: filter.search, mode: "insensitive" } },
            { jobTitle: { contains: filter.search, mode: "insensitive" } },
            { department: { name: { contains: filter.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const where: Prisma.JmlCaseWhereInput = {
    AND: [
      scope,
      { caseType: "JOIN", employee },
      filter.status === "draft"
        ? { status: "DRAFT" }
        : filter.status === "active"
          ? { status: { not: "DRAFT" } }
          : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.jmlCase.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
      select: {
        id: true,
        caseRef: true,
        status: true,
        joinDetail: { select: { plannedStartDate: true } },
        employee: {
          select: {
            name: true,
            employeeCode: true,
            jobTitle: true,
            contractType: true,
            entity: { select: { code: true, name: true } },
            department: { select: { name: true } },
          },
        },
      },
    }),
    prisma.jmlCase.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      caseId: r.id,
      caseRef: r.status === "DRAFT" ? null : r.caseRef,
      status: r.status,
      fullName: r.employee.name,
      employeeCode: r.employee.employeeCode,
      jobTitle: r.employee.jobTitle,
      company: r.employee.entity.name,
      department: r.employee.department?.name ?? null,
      employmentType: r.employee.contractType,
      plannedStartDate: r.joinDetail?.plannedStartDate?.toISOString().slice(0, 10) ?? null,
    })),
    total,
  };
}
