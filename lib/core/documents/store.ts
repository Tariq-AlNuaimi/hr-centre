import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isStorageConfigured, putPrivateFile, signedReadUrl } from "@/lib/storage";
import { MAX_DOCUMENT_BYTES, sniffType } from "./file-type";

/**
 * The core document store (ADR-098): files HR keep on a person's record. Bytes
 * live in the PRIVATE blob store at a pathname derived from the record (a
 * client never chooses where they land); a read is a short-lived signed URL
 * issued only after the route's checks. Type is sniffed from the bytes.
 * Deleting is a soft delete (recycling bin); the bytes stay until purge.
 */

export class DocumentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const pathnameFor = (employeeId: string, docId: string) => `employees/${employeeId}/docs/${docId}`;

export async function uploadEmployeeDocument(input: {
  employeeId: string;
  file: File;
  title: string;
  category: string;
  restricted: boolean;
  uploadedById: string;
}) {
  if (!isStorageConfigured())
    throw new DocumentError(
      "File storage isn't configured for this environment, so documents can't be uploaded yet.",
      503,
    );
  if (input.file.size === 0) throw new DocumentError("The file is empty.", 400);
  if (input.file.size > MAX_DOCUMENT_BYTES)
    throw new DocumentError("That file is larger than 10 MB.", 400);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) throw new DocumentError("Upload a PDF or an image (PNG, JPEG or WebP).", 400);
  const id = `d${randomUUID().replace(/-/g, "")}`;
  const blobPathname = pathnameFor(input.employeeId, id);
  await putPrivateFile(blobPathname, bytes, type);
  return prisma.document.create({
    data: {
      id,
      employeeId: input.employeeId,
      title: input.title,
      category: input.category,
      fileName: input.file.name.slice(0, 255),
      contentType: type,
      sizeBytes: bytes.byteLength,
      blobPathname,
      restricted: input.restricted,
      uploadedById: input.uploadedById,
    },
    select: { id: true, title: true, category: true, restricted: true, createdAt: true },
  });
}

/** One live document of this employee, or null. */
export function findEmployeeDocument(employeeId: string, id: string) {
  return prisma.document.findFirst({
    where: { id, employeeId },
    select: { id: true, restricted: true, blobPathname: true },
  });
}

export function documentReadUrl(doc: { blobPathname: string }) {
  return signedReadUrl(doc.blobPathname);
}

export async function removeEmployeeDocument(id: string) {
  await prisma.document.delete({ where: { id } });
}
