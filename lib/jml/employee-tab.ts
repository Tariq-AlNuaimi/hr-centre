import { prisma } from "@/lib/prisma";
import { canFor, subjectOf, type JmlActor } from "./access";

/**
 * The "Joiners, movers & leavers" tab on the employee record (F-e): every JML
 * case of this person, and what they hold on the register (assets not yet
 * returned, access granted). Only for someone who may see JML cases for this
 * person's placement — otherwise the tab is absent.
 */
/** Whether the tab shows at all — one cheap read, done on every record view. */
export async function jmlTabVisible(actor: JmlActor, employeeId: string): Promise<boolean> {
  const e = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { entityId: true, departmentId: true, department: { select: { directorateId: true } } },
  });
  return Boolean(e && canFor(actor, "jml.view", subjectOf(e)));
}

export async function employeeJml(actor: JmlActor, employeeId: string) {
  if (!(await jmlTabVisible(actor, employeeId))) return null;
  const [cases, assets, access] = await Promise.all([
    prisma.jmlCase.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        caseRef: true,
        caseType: true,
        status: true,
        stage: true,
        completionPct: true,
        createdAt: true,
        hrOwner: { select: { name: true } },
        joinDetail: { select: { plannedStartDate: true, actualStartDate: true } },
        moveDetail: { select: { changeType: true, effectiveDate: true } },
        leaveDetail: { select: { exitType: true, lastDayOfService: true, migrated: true } },
      },
    }),
    prisma.jmlAsset.findMany({
      where: { employeeId, returnedDate: null, writtenOff: false },
      select: {
        id: true,
        identifier: true,
        issuedDate: true,
        assetType: { select: { label: true } },
      },
      take: 100,
    }),
    prisma.jmlAccessItem.findMany({
      where: { employeeId, direction: "GRANT", confirmedDate: { not: null } },
      select: { id: true, systemName: true, domain: true, confirmedDate: true },
      take: 100,
    }),
  ]);
  return { cases, assets, access };
}

export type EmployeeJml = NonNullable<Awaited<ReturnType<typeof employeeJml>>>;

/**
 * Employee › Documents (ADR-098): the letters generated on this person's cases,
 * for a viewer who may see their JML cases. Opened from the case's documents tab.
 */
export async function employeeJmlDocuments(actor: JmlActor, employeeId: string) {
  if (!(await jmlTabVisible(actor, employeeId))) return [];
  const rows = await prisma.jmlGeneratedDocument.findMany({
    where: { case: { employeeId } },
    orderBy: { generatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      documentType: true,
      templateVersion: true,
      generatedAt: true,
      case: { select: { id: true, caseRef: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: `${r.case.caseRef} · ${r.documentType} v${r.templateVersion}`,
    category: r.documentType,
    date: r.generatedAt,
    href: `/jml/cases/${r.case.id}?tab=documents`,
  }));
}
