import { prisma } from "@/lib/prisma";
import { isoWeekday, weekendDays } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { caseScopeWhere, type JmlActor } from "../access";

/**
 * The exit calendar (Offboarding Module 15, AC-15.1/15.2): exit DATES only
 * (last physical working day and last day of service, never task dates), for
 * cases that are not cancelled; two linked entries when the dates differ, one
 * otherwise; a date on a weekend is flagged, not moved. Read-only — no drag
 * to reschedule (dates change on the case, where the recalculation happens).
 */

export type ExitEntry = {
  caseId: string;
  caseRef: string;
  employeeName: string;
  status: string;
  kind: "LPWD" | "LDS" | "BOTH";
  date: string;
  onWeekend: boolean;
  linkedTo: string | null;
};

export async function exitCalendar(actor: JmlActor, year: number, month: number) {
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return { entries: [] as ExitEntry[] };
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.jmlCase.findMany({
    where: {
      AND: [
        scope,
        { caseType: "LEAVE", status: { notIn: ["CANCELLED"] }, cancelledAt: null },
        {
          leaveDetail: {
            OR: [
              { lastPhysicalWorkingDay: { gte: from, lt: to } },
              { lastDayOfService: { gte: from, lt: to } },
            ],
          },
        },
      ],
    },
    select: {
      id: true,
      caseRef: true,
      status: true,
      leaveDetail: {
        select: { employeeNameAtExit: true, lastPhysicalWorkingDay: true, lastDayOfService: true },
      },
    },
    orderBy: { caseRef: "asc" },
    take: 1000,
  });
  const weekend = new Set(weekendDays(await loadSchedule()));
  const inMonth = (d: Date) => d >= from && d < to;
  const entry = (
    r: (typeof rows)[number],
    kind: ExitEntry["kind"],
    d: Date,
    linkedTo: string | null,
  ): ExitEntry => ({
    caseId: r.id,
    caseRef: r.caseRef,
    employeeName: r.leaveDetail!.employeeNameAtExit,
    status: r.status,
    kind,
    date: d.toISOString().slice(0, 10),
    onWeekend: weekend.has(isoWeekday(d)),
    linkedTo,
  });
  const entries: ExitEntry[] = [];
  for (const r of rows) {
    const { lastPhysicalWorkingDay: lpwd, lastDayOfService: lds } = r.leaveDetail!;
    if (lpwd && lds && lpwd.getTime() === lds.getTime()) {
      if (inMonth(lds)) entries.push(entry(r, "BOTH", lds, null));
      continue;
    }
    if (lpwd && inMonth(lpwd))
      entries.push(entry(r, "LPWD", lpwd, lds ? lds.toISOString().slice(0, 10) : null));
    if (lds && inMonth(lds))
      entries.push(entry(r, "LDS", lds, lpwd ? lpwd.toISOString().slice(0, 10) : null));
  }
  return {
    entries: entries.sort(
      (a, b) => a.date.localeCompare(b.date) || a.caseRef.localeCompare(b.caseRef),
    ),
  };
}
