import { prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, type JmlActor } from "../access";
import { DEFAULT_NOTICE_DAYS } from "./rules";

/** The exit view of a case — the Overview tab, the edit dialogs and the activation panel read it. */

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function getExit(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const d = await prisma.leaveCaseDetail.findUniqueOrThrow({
    where: { caseId },
    include: { lineManager: { select: { id: true, name: true } } },
  });
  const [entity, department] = await Promise.all([
    prisma.orgEntity.findUnique({ where: { id: d.entityIdAtExit }, select: { name: true } }),
    d.departmentIdAtExit
      ? prisma.department.findUnique({
          where: { id: d.departmentIdAtExit },
          select: { name: true },
        })
      : null,
  ]);
  const can = {
    manage: canFor(actor, "jml.manageLeavers", kase.subject),
    decide: canFor(actor, "jml.decideApprovals", kase.subject),
    override: canFor(actor, "jml.overrideGates", kase.subject),
    settlement: canFor(actor, "jml.manageSettlement", kase.subject),
    close: canFor(actor, "jml.closeLeavers", kase.subject),
  };
  return {
    caseId,
    caseRef: kase.caseRef,
    status: kase.status,
    stage: kase.stage,
    version: kase.version,
    employeeId: kase.employeeId,
    exitType: d.exitType,
    exitSubtype: d.exitSubtype,
    nationality: d.nationality,
    employmentTypeAtExit: d.employmentTypeAtExit,
    noticeStartDate: day(d.noticeStartDate),
    noticePeriodDays: d.noticePeriodDays,
    defaultNoticeDays: DEFAULT_NOTICE_DAYS[d.exitType],
    noticePeriodOverrideReason: d.noticePeriodOverrideReason,
    lastPhysicalWorkingDay: day(d.lastPhysicalWorkingDay),
    lastDayOfService: day(d.lastDayOfService),
    departureDate: day(d.departureDate),
    earlyReleaseApproved: d.earlyReleaseApproved,
    settlementApplicable: d.settlementApplicable,
    visaSupportApplicable: d.visaSupportApplicable,
    docRefPerformanceHistory: d.docRefPerformanceHistory,
    docRefWrittenGrounds: d.docRefWrittenGrounds,
    docRefLegalReview: d.docRefLegalReview,
    backfillDecision: d.backfillDecision,
    backfillApprovalRef: d.backfillApprovalRef,
    rehireEligible: d.rehireEligible,
    migrated: d.migrated,
    rekeyedAt: d.rekeyedAt?.toISOString() ?? null,
    rekeyReason: d.rekeyReason,
    employeeName: d.employeeNameAtExit,
    jobTitle: d.jobTitleAtExit,
    grade: d.gradeAtExit,
    positionClassification: d.positionClassificationName,
    entityName: entity?.name ?? null,
    departmentName: department?.name ?? null,
    lineManager: d.lineManager,
    loginRevokedAt: d.loginRevokedAt?.toISOString() ?? null,
    departureAppliedAt: d.departureAppliedAt?.toISOString() ?? null,
    can,
  };
}

export type ExitView = Awaited<ReturnType<typeof getExit>>;
