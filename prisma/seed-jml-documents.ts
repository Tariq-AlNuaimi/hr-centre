import { readFileSync } from "node:fs";
import path from "node:path";
import type { JmlDocumentType, PrismaClient } from "../generated/prisma/client";

/**
 * The nine DEFAULT leaver document templates (ADR-083), authored by
 * `scripts/jml-author-docs.mjs` and committed under prisma/jml-docs/.
 * Idempotent and production-safe: a type that already has ANY template is left
 * alone, so HR's uploads are never overwritten. Seeded ACTIVE and marked
 * default — HR replaces each with its real letter.
 */

const NAMES: Record<JmlDocumentType, string> = {
  ACCEPTANCE_OF_RESIGNATION: "Acceptance of resignation",
  TERMINATION_NOTIFICATION: "Termination notification",
  NON_RENEWAL_NOTIFICATION: "Non-renewal notification",
  BANK_TERMINATION_NOTICE: "Bank termination notice",
  REPATRIATION_TICKET_REQUEST: "Repatriation ticket request",
  IT_ACCESS_REVOCATION_INSTRUCTION: "IT access revocation instruction",
  FINAL_SETTLEMENT_WORKSHEET: "Final settlement worksheet",
  SETTLEMENT_TRANSMITTAL_TO_FINANCE: "Settlement transmittal to Finance",
  CERTIFICATE_OF_SERVICE: "Certificate of service",
};

export async function seedJmlDocuments(prisma: PrismaClient): Promise<void> {
  const dir = path.join(process.cwd(), "prisma", "jml-docs");
  for (const [type, name] of Object.entries(NAMES) as [JmlDocumentType, string][]) {
    const exists = await prisma.jmlDocumentTemplate.findFirst({
      where: { documentType: type },
      select: { id: true },
    });
    if (exists) continue;
    const body = readFileSync(path.join(dir, `${type}.docx`)).toString("base64");
    await prisma.jmlDocumentTemplate.create({
      data: {
        documentType: type,
        name,
        version: 1,
        state: "ACTIVE",
        body,
        isDefault: true,
        approvedAt: new Date(),
      },
    });
  }
}
