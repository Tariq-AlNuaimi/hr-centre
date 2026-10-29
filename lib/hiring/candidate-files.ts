import { prisma } from "@/lib/prisma";
import {
  deleteStoredFile,
  isStorageConfigured,
  putPrivateFile,
  signedReadUrl,
} from "@/lib/storage";
import type { HiringActor } from "./access";
import { seesCandidateComp, type LoadedCandidate } from "./candidates";
import {
  bandMidpoint,
  currentPackageFrom,
  PAYSLIP_MONTHS_REQUESTED,
  pricingBasisFor,
  reviewedPayslips,
} from "./candidate-rules";
import { newHiringId, openAmount, sealAmount } from "./comp-crypto";
import { HiringRuleError } from "./http";
import { peopleById, personOrNull } from "./people";
import { toOMRorNull } from "./money";
import { DOC_TYPES, MAX_DOCUMENT_BYTES, sniffType } from "@/lib/core/documents/file-type";

/**
 * CVs and package evidence (Interview Hub `cv`, `documents`, `package` routes).
 * Files live in the PRIVATE blob store at pathnames derived from the record;
 * a read is a five-minute signed URL issued only after the route's checks.
 * The bytes are sniffed here: a file is what its first bytes say, not what the
 * browser claimed.
 */

export const MAX_FILE_BYTES = MAX_DOCUMENT_BYTES;
const DOC_CAP = 200;

export const cvPathname = (candidateId: string) => `hiring/cvs/${candidateId}/cv.pdf`;
const documentPathname = (candidateId: string, docId: string) =>
  `hiring/docs/${candidateId}/${docId}`;

/** The content type the bytes actually are (core, ADR-098). */
export { sniffType };

export function requireStorage() {
  if (!isStorageConfigured()) {
    throw new HiringRuleError(
      "File storage isn't configured for this environment, so files cannot be uploaded or opened yet. Everything else on this screen still works.",
      503,
      "STORAGE_NOT_CONFIGURED",
    );
  }
}

export async function readChecked(file: File, accepted: readonly string[]) {
  if (file.size === 0) throw new HiringRuleError("The file is empty.", 400);
  if (file.size > MAX_FILE_BYTES) throw new HiringRuleError("File too large (max 10 MB).", 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = sniffType(buffer);
  if (!type || !accepted.includes(type)) {
    throw new HiringRuleError(
      accepted.length === 1
        ? "Only PDF files are accepted."
        : "Only a PDF or an image is accepted.",
      400,
    );
  }
  return { buffer, type };
}

// ---------------------------------------------------------------- CV

export async function uploadCv(l: LoadedCandidate, file: File) {
  requireStorage();
  const { buffer } = await readChecked(file, ["application/pdf"]);
  const pathname = cvPathname(l.cand.id);
  await putPrivateFile(pathname, buffer, "application/pdf", { overwrite: true });
  await prisma.hiringCandidate.update({
    where: { id: l.cand.id },
    data: { cvBlobPathname: pathname, cvFileName: file.name.slice(0, 255) },
    select: { id: true },
  });
}

export async function cvUrl(l: LoadedCandidate): Promise<string | null> {
  if (!l.cand.cvBlobPathname) return null;
  requireStorage();
  return signedReadUrl(l.cand.cvBlobPathname);
}

// ---------------------------------------------------------------- documents

export async function listDocuments(actor: HiringActor, l: LoadedCandidate) {
  const comp = seesCandidateComp(actor, l);
  const docs = await prisma.hiringCandidateDocument.findMany({
    where: { candidateId: l.cand.id },
    orderBy: [{ periodMonth: "asc" }, { createdAt: "asc" }],
    take: DOC_CAP,
  });
  const people = await peopleById(docs.flatMap((d) => [d.uploadedById, d.reviewedById]));
  return docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    periodMonth: d.periodMonth,
    fileName: d.fileName,
    sizeBytes: d.sizeBytes,
    currency: d.currency,
    fromCandidate: d.fromCandidate,
    createdAt: d.createdAt,
    reviewedAt: d.reviewedAt,
    hasFile: Boolean(d.blobPathname),
    uploadedBy: personOrNull(people, d.uploadedById),
    reviewedBy: personOrNull(people, d.reviewedById),
    // Restricted: the stated pay and HR's note, comp readers only.
    statedAmount: comp ? openAmount("document", d.id, "statedAmount", d.statedAmountEnc) : null,
    reviewNote: comp ? d.reviewNote : null,
  }));
}

export async function uploadDocument(
  actor: HiringActor,
  l: LoadedCandidate,
  file: File,
  fields: {
    kind:
      | "PAYSLIP"
      | "BANK_STATEMENT"
      | "EMPLOYMENT_CONTRACT"
      | "CERTIFICATE"
      | "ID_DOCUMENT"
      | "OTHER";
    label: string;
    periodMonth?: string | null;
    statedAmount?: number | null;
    fromCandidate: boolean;
  },
) {
  requireStorage();
  const { buffer, type } = await readChecked(file, DOC_TYPES);
  const id = newHiringId();
  const pathname = documentPathname(l.cand.id, id);
  // Store first: a row whose bytes never landed would be a broken link on the evidence trail.
  await putPrivateFile(pathname, buffer, type);
  const amount = seesCandidateComp(actor, l) ? (fields.statedAmount ?? null) : null;
  await prisma.hiringCandidateDocument.create({
    data: {
      id,
      candidateId: l.cand.id,
      kind: fields.kind,
      label: fields.label,
      periodMonth: fields.periodMonth ? new Date(fields.periodMonth) : null,
      fileName: file.name.slice(0, 255),
      contentType: type,
      sizeBytes: buffer.byteLength,
      blobPathname: pathname,
      statedAmountEnc: sealAmount("document", id, "statedAmount", amount),
      fromCandidate: fields.fromCandidate,
      uploadedById: actor.userId,
    },
    select: { id: true },
  });
  if (fields.kind === "PAYSLIP" && ["NOT_REQUESTED", "REQUESTED"].includes(l.cand.packageStatus)) {
    await prisma.hiringCandidate.update({
      where: { id: l.cand.id },
      data: { packageStatus: "RECEIVED" },
      select: { id: true },
    });
  }
  return { id };
}

export async function loadDocument(l: LoadedCandidate, docId: string) {
  const doc = await prisma.hiringCandidateDocument.findUnique({ where: { id: docId } });
  return doc && doc.candidateId === l.cand.id ? doc : null;
}

export async function documentUrl(doc: { blobPathname: string | null }) {
  if (!doc.blobPathname) return null;
  requireStorage();
  return signedReadUrl(doc.blobPathname);
}

export async function reviewDocument(
  actor: HiringActor,
  doc: { id: string; reviewedAt: Date | null },
  body: {
    reviewed?: boolean;
    statedAmount?: number | null;
    reviewNote?: string | null;
    label?: string;
  },
) {
  await prisma.hiringCandidateDocument.update({
    where: { id: doc.id },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.reviewNote !== undefined ? { reviewNote: body.reviewNote || null } : {}),
      ...(body.statedAmount !== undefined
        ? { statedAmountEnc: sealAmount("document", doc.id, "statedAmount", body.statedAmount) }
        : {}),
      ...(body.reviewed === undefined
        ? {}
        : body.reviewed
          ? { reviewedById: actor.userId, reviewedAt: doc.reviewedAt ?? new Date() }
          : { reviewedById: null, reviewedAt: null }),
    },
    select: { id: true },
  });
}

/** Remove the row; the bytes go too (best-effort — the audit row keeps who read it). */
export async function removeDocument(doc: { id: string; blobPathname: string | null }) {
  await prisma.hiringCandidateDocument.delete({ where: { id: doc.id } });
  if (doc.blobPathname && isStorageConfigured()) {
    await deleteStoredFile(doc.blobPathname).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- package

export async function packageView(actor: HiringActor, l: LoadedCandidate) {
  const c = l.cand;
  const comp = seesCandidateComp(actor, l);
  const docs = await prisma.hiringCandidateDocument.findMany({
    where: { candidateId: c.id },
    select: { id: true, kind: true, statedAmountEnc: true, reviewedAt: true },
    take: DOC_CAP,
  });
  const evidence = docs.map((d) => ({
    kind: d.kind,
    reviewedAt: d.reviewedAt,
    statedAmount: comp ? openAmount("document", d.id, "statedAmount", d.statedAmountEnc) : null,
  }));
  const req = c.requisition;
  const min = req ? toOMRorNull(req.salaryBandMin, req.salaryCurrency) : null;
  const max = req ? toOMRorNull(req.salaryBandMax, req.salaryCurrency) : null;
  const people = await peopleById([c.packageConfirmedById]);
  return {
    compVisible: comp,
    status: c.packageStatus,
    basis: pricingBasisFor(c.packageStatus),
    reviewedPayslips: reviewedPayslips(evidence),
    payslipsRequested: PAYSLIP_MONTHS_REQUESTED,
    requestedAt: c.packageRequestedAt,
    confirmedAt: c.packageConfirmedAt,
    confirmedBy: personOrNull(people, c.packageConfirmedById),
    declinedAt: comp ? c.packageDeclinedAt : null,
    declinedReason: comp ? c.packageDeclinedReason : null,
    currentPackage: comp ? currentPackageFrom(evidence) : null,
    expectation: comp
      ? openAmount("candidate", c.id, "salaryExpectation", c.salaryExpectationEnc)
      : null,
    band: comp ? { min, max } : { min: null, max: null },
    midpoint: comp ? bandMidpoint(min, max) : null,
  };
}

type PackageAction =
  | { action: "request" }
  | { action: "decline"; reason: string }
  | { action: "confirm" }
  | { action: "reopen" };

const PACKAGE_DATA = (actor: HiringActor, a: PackageAction) => {
  const now = new Date();
  switch (a.action) {
    case "request":
      return { packageStatus: "REQUESTED" as const, packageRequestedAt: now };
    case "decline":
      return {
        packageStatus: "DECLINED" as const,
        packageDeclinedAt: now,
        packageDeclinedReason: a.reason,
      };
    case "confirm":
      return {
        packageStatus: "CONFIRMED" as const,
        packageConfirmedAt: now,
        packageConfirmedById: actor.userId,
        packageDeclinedAt: null,
        packageDeclinedReason: null,
      };
    case "reopen":
      return {
        packageStatus: "REQUESTED" as const,
        packageRequestedAt: now,
        packageDeclinedAt: null,
        packageDeclinedReason: null,
        packageConfirmedAt: null,
        packageConfirmedById: null,
      };
  }
};

export async function packageAction(actor: HiringActor, l: LoadedCandidate, a: PackageAction) {
  await prisma.hiringCandidate.update({
    where: { id: l.cand.id },
    data: PACKAGE_DATA(actor, a),
    select: { id: true },
  });
}
