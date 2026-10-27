import type { JmlCaseStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PaginationParams } from "@/lib/pagination";
import { isProvisionalOdooId } from "@/lib/people/provisional-id";
import type { CaseListInput } from "@/lib/validations/jml/case";
import { canFor, caseScopeWhere, loadCaseFor, MANAGE_PERMISSION, type JmlActor } from "../access";
import { externalSystems } from "../desks";
import { TASK_STATUSES } from "../vocab";

/**
 * Reading cases — every type. The list defaults to work in flight plus
 * completed (Onboarding `listCases`); drafts live on the joiners screen.
 */

const DEFAULT_STATUSES: JmlCaseStatus[] = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT", "COMPLETED"];

function caseListWhere(actor: JmlActor, f: CaseListInput): Prisma.JmlCaseWhereInput | null {
  const scope = caseScopeWhere(actor, "jml.view");
  if (scope === null) return null;
  const statuses = f.status && f.status.length > 0 ? f.status : DEFAULT_STATUSES;
  return {
    AND: [
      scope,
      { status: { in: statuses.filter((s) => s !== "DRAFT") } },
      f.caseType ? { caseType: f.caseType } : {},
      f.stage ? { stage: f.stage } : {},
      f.mine === "true" ? { hrOwnerUserId: actor.userId } : {},
      f.entityId ? { employee: { entityId: f.entityId } } : {},
      f.search
        ? {
            OR: [
              { caseRef: { contains: f.search, mode: "insensitive" } },
              { employee: { name: { contains: f.search, mode: "insensitive" } } },
              { employee: { employeeCode: { contains: f.search, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
}

const CASE_ROW_SELECT = {
  id: true,
  caseRef: true,
  caseType: true,
  status: true,
  stage: true,
  completionPct: true,
  ragFlag: true,
  activatedAt: true,
  hrOwner: { select: { id: true, name: true } },
  joinDetail: { select: { plannedStartDate: true, actualStartDate: true } },
  employee: {
    select: {
      id: true,
      name: true,
      employeeCode: true,
      jobTitle: true,
      contractType: true,
      entity: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

export type CaseRow = Prisma.JmlCaseGetPayload<{ select: typeof CASE_ROW_SELECT }>;

export async function listCases(actor: JmlActor, f: CaseListInput, page: PaginationParams) {
  const where = caseListWhere(actor, f);
  if (!where) return { rows: [] as CaseRow[], total: 0 };
  const [rows, total] = await Promise.all([
    prisma.jmlCase.findMany({
      where,
      orderBy: [{ activatedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
      select: CASE_ROW_SELECT,
    }),
    prisma.jmlCase.count({ where }),
  ]);
  return { rows, total };
}

const DETAIL_SELECT = {
  id: true,
  caseRef: true,
  caseType: true,
  status: true,
  stage: true,
  completionPct: true,
  ragFlag: true,
  version: true,
  activatedAt: true,
  completedAt: true,
  closedAt: true,
  cancelledAt: true,
  cancelReason: true,
  duplicateOverrideReason: true,
  archivedAt: true,
  legalHold: true,
  legalHoldReason: true,
  legalHoldAt: true,
  anonymisedAt: true,
  hrOwner: { select: { id: true, name: true, email: true } },
  seniorHr: { select: { id: true, name: true } },
  lastUpdatedBy: { select: { id: true, name: true } },
  template: { select: { id: true, name: true, version: true } },
  joinDetail: {
    select: {
      plannedStartDate: true,
      actualStartDate: true,
      contractType: { select: { name: true } },
      payrollApplicable: true,
      itReadinessConfirmed: true,
      itReadinessAt: true,
      itIntakeSubmittedAt: true,
      itIntakeReference: true,
      itIntakeError: true,
    },
  },
  leaveDetail: { select: { exitType: true } },
  moveDetail: {
    select: {
      changeType: true,
      effectiveDate: true,
      previousDetails: true,
      newDetails: true,
      appliedAt: true,
      applyNote: true,
    },
  },
  employee: {
    select: {
      id: true,
      odooId: true,
      employeeCode: true,
      status: true,
      name: true,
      jobTitle: true,
      contractType: true,
      nationality: true,
      entity: { select: { name: true } },
      department: { select: { name: true, directorate: { select: { name: true } } } },
      manager: { select: { id: true, name: true } },
    },
  },
} as const satisfies Prisma.JmlCaseSelect;

/** One case with the actor's affordances (re-checked by every action route). */
export async function getCaseDetail(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view");
  const row = await prisma.jmlCase.findUnique({ where: { id: caseId }, select: DETAIL_SELECT });
  if (!row) return null;
  const s = kase.subject;
  const { leaveDetail, ...rest } = row;
  return {
    ...rest,
    exitType: leaveDetail?.exitType ?? null,
    employee: {
      ...row.employee,
      odooId: isProvisionalOdooId(row.employee.odooId) ? null : row.employee.odooId,
    },
    externalLinks: externalSystems(),
    // What a person may set by hand: CANCELLED is the case's to apply, not a task's.
    taskStatuses: TASK_STATUSES[row.caseType].filter((x) => x !== "CANCELLED"),
    can: {
      manage: canFor(actor, MANAGE_PERMISSION[row.caseType], s),
      close: row.caseType === "LEAVE" && canFor(actor, "jml.closeLeavers", s),
      workTasks: canFor(actor, "jml.workTasks", s),
      reopenTasks: canFor(actor, "jml.reopenTasks", s),
      supervise: canFor(actor, "jml.supervise", s),
    },
  };
}

export async function listCaseEmails(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view");
  return prisma.jmlEmailLog.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      recipient: true,
      cc: true,
      subject: true,
      status: true,
      scheduledFor: true,
      sentAt: true,
      failureReason: true,
      resendOfId: true,
      createdAt: true,
      sentBy: { select: { name: true } },
    },
  });
}
