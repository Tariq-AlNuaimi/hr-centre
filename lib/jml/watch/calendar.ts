import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { weekendDays, isoWeekday } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import type { CalendarInput } from "@/lib/validations/jml/case";
import { caseScopeWhere, type JmlActor } from "../access";
import { JmlError } from "../errors";

/**
 * The joining calendar — HR Onboarding `calendar.ts` (§12): joining dates only
 * (actual, else planned), drafts included, cancelled/archived excluded, one
 * read serving the month, week and list views and the range totals. The
 * weekend comes from the working schedule, not a hard-coded Fri/Sat.
 */

const MONTH_LIMIT = 400;
const MAX_LIMIT = 5000;
const MAX_SPAN_DAYS = 366;

function limitForSpan(from: Date, to: Date): number {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  return Math.min(MAX_LIMIT, Math.max(MONTH_LIMIT, Math.ceil(days / 30) * MONTH_LIMIT));
}

function statusWhere(f: CalendarInput): Prisma.JmlCaseWhereInput {
  if (f.status === "DRAFT") return f.hrOwnerUserId ? { id: { in: [] } } : { status: "DRAFT" };
  const owned = f.hrOwnerUserId ? { hrOwnerUserId: f.hrOwnerUserId } : {};
  if (f.status) return { ...owned, status: f.status };
  return { ...owned, status: { notIn: ["CANCELLED", "ARCHIVED"] } };
}

function employeeWhere(f: CalendarInput): Prisma.EmployeeWhereInput {
  return {
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.directorateId ? { department: { directorateId: f.directorateId } } : {}),
    ...(f.employmentType ? { contractType: f.employmentType } : {}),
    ...(f.workLocation ? { workLocation: { equals: f.workLocation, mode: "insensitive" } } : {}),
  };
}

export async function joiningCalendar(actor: JmlActor, f: CalendarInput) {
  if (f.to < f.from) throw new JmlError("The range must end on or after its start.", 422);
  const span = (f.to.getTime() - f.from.getTime()) / 86_400_000;
  if (span > MAX_SPAN_DAYS) throw new JmlError("Choose a range of at most a year.", 422);
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return { entries: [], truncated: false };
  const end = new Date(f.to.getTime() + 86_400_000);
  const take = limitForSpan(f.from, end);
  const rows = await prisma.jmlCase.findMany({
    where: {
      AND: [
        scope,
        { caseType: "JOIN", employee: employeeWhere(f) },
        statusWhere(f),
        {
          joinDetail: {
            OR: [
              { actualStartDate: { gte: f.from, lt: end } },
              { actualStartDate: null, plannedStartDate: { gte: f.from, lt: end } },
            ],
          },
        },
      ],
    },
    select: {
      id: true,
      caseRef: true,
      status: true,
      hrOwner: { select: { name: true } },
      joinDetail: { select: { plannedStartDate: true, actualStartDate: true } },
      employee: {
        select: {
          name: true,
          employeeCode: true,
          jobTitle: true,
          contractType: true,
          workLocation: true,
          entity: { select: { name: true } },
          department: { select: { name: true, directorate: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: take + 1,
  });
  const weekend = new Set<number>(weekendDays(await loadSchedule()));
  const entries = rows.slice(0, take).map((r) => {
    const date = (r.joinDetail?.actualStartDate ?? r.joinDetail?.plannedStartDate)!;
    return {
      caseId: r.id,
      caseRef: r.status === "DRAFT" ? null : r.caseRef,
      fullName: r.employee.name,
      employeeCode: r.employee.employeeCode,
      jobTitle: r.employee.jobTitle,
      company: r.employee.entity.name,
      directorate: r.employee.department?.directorate?.name ?? null,
      department: r.employee.department?.name ?? null,
      employmentType: r.employee.contractType,
      workLocation: r.employee.workLocation,
      hrOwner: r.hrOwner?.name ?? null,
      date: date.toISOString().slice(0, 10),
      confirmed: Boolean(r.joinDetail?.actualStartDate),
      status: r.status,
      onWeekend: weekend.has(isoWeekday(date)),
    };
  });
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.fullName.localeCompare(b.fullName));
  return { entries, truncated: rows.length > take };
}

export type CalendarEntry = Awaited<ReturnType<typeof joiningCalendar>>["entries"][number];

/** Range totals and the seven breakdowns (§12). */
export function calendarTotals(entries: readonly CalendarEntry[]) {
  const count = (key: (e: CalendarEntry) => string | null) => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = key(e) ?? "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => b.count - a.count);
  };
  return {
    total: entries.length,
    confirmed: entries.filter((e) => e.confirmed).length,
    onWeekend: entries.filter((e) => e.onWeekend).length,
    byCompany: count((e) => e.company),
    byDirectorate: count((e) => e.directorate),
    byDepartment: count((e) => e.department),
    byEmploymentType: count((e) => e.employmentType),
    byWorkLocation: count((e) => e.workLocation),
    byStatus: count((e) => e.status),
    byHrOwner: count((e) => e.hrOwner),
  };
}
