import type { JmlDocumentType } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { holdsGroup, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { validateTemplateBuffer } from "./engine";

/**
 * Document templates (Offboarding `/api/offboarding-admin/templates`):
 * upload → DRAFT version N+1; an HR Manager activates it (retiring the active
 * one of that type) — never their own upload (BR-OFF-034: author ≠ approver);
 * retire. The nine seeded defaults are active from day one and marked default.
 */

const LIST_SELECT = {
  id: true,
  documentType: true,
  name: true,
  version: true,
  state: true,
  language: true,
  isDefault: true,
  approvedAt: true,
  retiredAt: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
} as const;

export async function listTemplates(actor: JmlActor) {
  const rows = await prisma.jmlDocumentTemplate.findMany({
    orderBy: [{ documentType: "asc" }, { version: "desc" }],
    select: LIST_SELECT,
    take: 300,
  });
  return {
    templates: rows,
    can: {
      upload: holdsGroup(actor, "jml.configure"),
      activate: holdsGroup(actor, "jml.activateDocuments"),
    },
  };
}

export async function uploadTemplate(
  actor: JmlActor,
  input: { documentType: JmlDocumentType; name: string; language: string; base64: string },
) {
  const buffer = Buffer.from(input.base64, "base64");
  const { issues, placeholders } = validateTemplateBuffer(buffer);
  if (issues.length) throw new JmlError(issues.map((i) => i.message).join(" "), 422);
  const latest = await prisma.jmlDocumentTemplate.findFirst({
    where: { documentType: input.documentType },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const created = await auditedTransaction((tx) =>
    tx.jmlDocumentTemplate.create({
      data: {
        documentType: input.documentType,
        name: input.name,
        version: (latest?.version ?? 0) + 1,
        state: "DRAFT",
        body: buffer.toString("base64"),
        language: input.language,
        uploadedById: actor.userId,
      },
      select: { id: true, version: true },
    }),
  );
  return { ...created, placeholders };
}

export async function activateTemplate(actor: JmlActor, templateId: string) {
  const t = await prisma.jmlDocumentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, state: true, documentType: true, uploadedById: true },
  });
  if (!t) throw new JmlError("Template not found", 404);
  if (t.state !== "DRAFT") throw new JmlError("Only a draft template can be activated.", 409);
  if (t.uploadedById === actor.userId) {
    throw new JmlError(
      "The person who uploaded a template cannot also approve it (BR-OFF-034).",
      403,
    );
  }
  await auditedTransaction(async (tx) => {
    const active = await tx.jmlDocumentTemplate.findMany({
      where: { documentType: t.documentType, state: "ACTIVE" },
      select: { id: true },
    });
    for (const a of active) {
      await tx.jmlDocumentTemplate.update({
        where: { id: a.id },
        data: { state: "RETIRED", retiredAt: new Date() },
        select: { id: true },
      });
    }
    await tx.jmlDocumentTemplate.update({
      where: { id: t.id, state: "DRAFT" },
      data: { state: "ACTIVE", approvedById: actor.userId, approvedAt: new Date() },
      select: { id: true },
    });
  });
  return { activated: true };
}

export async function retireTemplate(templateId: string) {
  const t = await prisma.jmlDocumentTemplate.findUnique({
    where: { id: templateId },
    select: { state: true },
  });
  if (!t) throw new JmlError("Template not found", 404);
  if (t.state !== "ACTIVE") throw new JmlError("Only the active template can be retired.", 409);
  await auditedTransaction((tx) =>
    tx.jmlDocumentTemplate.update({
      where: { id: templateId },
      data: { state: "RETIRED", retiredAt: new Date() },
      select: { id: true },
    }),
  );
  return { retired: true };
}

/** The template file itself, so HR can start from it in Word. */
export async function templateFile(templateId: string) {
  const t = await prisma.jmlDocumentTemplate.findUnique({
    where: { id: templateId },
    select: { body: true, documentType: true, version: true },
  });
  if (!t) throw new JmlError("Template not found", 404);
  return {
    buffer: Buffer.from(t.body, "base64"),
    filename: `${t.documentType}-v${t.version}.docx`,
  };
}
