import type { JmlDocumentType } from "@/generated/prisma/client";
import { isProvisionalOdooId } from "@/lib/people/provisional-id";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { generationProblem, renderDocument, summaryDismissalHold, type MergeData } from "./engine";

/**
 * Generate a leaver document (Offboarding `POST …/documents`, AC-17.1/17.2,
 * BR-OFF-027). Default: the ACTIVE template; a regeneration is PINNED to the
 * version first used unless "use current" is chosen with a reason. Nothing is
 * stored but the metadata row; the bytes stream to the caller.
 */

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

async function mergeData(caseId: string, documentTitle: string): Promise<MergeData> {
  const c = await prisma.jmlCase.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      caseRef: true,
      hrOwner: { select: { name: true } },
      employee: { select: { odooId: true, employeeCode: true } },
      leaveDetail: {
        include: { lineManager: { select: { name: true } } },
      },
    },
  });
  const d = c.leaveDetail!;
  const [entity, dept] = await Promise.all([
    prisma.orgEntity.findUnique({ where: { id: d.entityIdAtExit }, select: { name: true } }),
    d.departmentIdAtExit
      ? prisma.department.findUnique({
          where: { id: d.departmentIdAtExit },
          select: { name: true, directorate: { select: { name: true } } },
        })
      : null,
  ]);
  const odoo = isProvisionalOdooId(c.employee.odooId) ? null : c.employee.odooId;
  return {
    caseRef: c.caseRef,
    employeeName: d.employeeNameAtExit,
    employeeExternalId: odoo ?? c.employee.employeeCode ?? "",
    jobTitle: d.jobTitleAtExit ?? "",
    companyName: entity?.name ?? "",
    directorateName: dept?.directorate?.name ?? "",
    departmentName: dept?.name ?? "",
    exitType: d.exitType,
    exitSubtype: d.exitSubtype ?? "",
    employmentType: d.employmentTypeAtExit ?? "",
    nationality: d.nationality,
    noticeStartDate: day(d.noticeStartDate),
    noticePeriodDays: String(d.noticePeriodDays),
    lastPhysicalWorkingDay: day(d.lastPhysicalWorkingDay),
    lastDayOfService: day(d.lastDayOfService),
    departureDate: day(d.departureDate),
    lineManagerName: d.lineManager?.name ?? "",
    hrOwnerName: c.hrOwner?.name ?? "",
    issueDate: day(new Date()),
    documentTitle,
  };
}

export async function listCaseDocuments(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const [generated, active] = await Promise.all([
    prisma.jmlGeneratedDocument.findMany({
      where: { caseId },
      orderBy: { generatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        documentType: true,
        templateVersion: true,
        currentVersionReason: true,
        generatedAt: true,
        generatedBy: { select: { name: true } },
        template: { select: { name: true, isDefault: true } },
      },
    }),
    prisma.jmlDocumentTemplate.findMany({
      where: { state: "ACTIVE" },
      select: { documentType: true, name: true, version: true, isDefault: true },
      take: 20,
    }),
  ]);
  return { generated, active, can: { generate: canFor(actor, "jml.manageLeavers", kase.subject) } };
}

async function pickTemplate(
  caseId: string,
  documentType: JmlDocumentType,
  useCurrent: boolean,
  reason: string | null,
) {
  const first = await prisma.jmlGeneratedDocument.findFirst({
    where: { caseId, documentType },
    orderBy: { generatedAt: "asc" },
    select: { templateId: true },
  });
  if (first && !useCurrent) {
    return {
      template: await prisma.jmlDocumentTemplate.findUniqueOrThrow({
        where: { id: first.templateId },
      }),
      reason: null,
    };
  }
  if (first && useCurrent && !reason?.trim()) {
    throw new JmlError(
      "Regenerating on the current template instead of the original needs a reason (AC-17.2).",
      422,
    );
  }
  const active = await prisma.jmlDocumentTemplate.findFirst({
    where: { documentType, state: "ACTIVE" },
  });
  if (!active) throw new JmlError("No active template exists for this document type.", 409);
  const problem = generationProblem(active);
  if (problem) throw new JmlError(problem, 409);
  return { template: active, reason: first ? reason : null };
}

export async function generateDocument(
  actor: JmlActor,
  caseId: string,
  input: { documentType: JmlDocumentType; useCurrent: boolean; reason: string | null },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (kase.status === "DRAFT")
    throw new JmlError("Documents are generated once the exit is active.", 409);
  const detail = await prisma.leaveCaseDetail.findUniqueOrThrow({
    where: { caseId },
    select: { exitType: true },
  });
  const tasks = await prisma.jmlTask.findMany({
    where: { caseId },
    select: { code: true, status: true },
    take: 300,
  });
  const hold = summaryDismissalHold(detail.exitType, tasks);
  if (hold) throw new JmlError(hold, 403);
  const { template, reason } = await pickTemplate(
    caseId,
    input.documentType,
    input.useCurrent,
    input.reason,
  );
  const buffer = renderDocument(
    Buffer.from(template.body, "base64"),
    await mergeData(caseId, template.name),
  );
  const row = await auditedTransaction((tx) =>
    tx.jmlGeneratedDocument.create({
      data: {
        caseId,
        documentType: input.documentType,
        templateId: template.id,
        templateVersion: template.version,
        currentVersionReason: reason,
        generatedById: actor.userId,
      },
      select: { id: true },
    }),
  );
  return {
    buffer,
    filename: `${kase.caseRef}-${input.documentType}-v${template.version}.docx`,
    generationId: row.id,
    templateVersion: template.version,
  };
}
