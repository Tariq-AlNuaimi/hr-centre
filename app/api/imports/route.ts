import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { ImportFileError, MAX_UPLOAD_BYTES } from "@/lib/pms/import/loaders/xlsx";
import { previewImport } from "@/lib/pms/import/run";

/**
 * Employee import — spec §3.
 *
 * POST is the DRY RUN. It parses, validates (§3.4), and computes a plan (§3.5),
 * records it as a PREVIEWED batch, and writes not one employee row. Applying is
 * a separate, explicitly confirmed call (`[id]/apply`).
 *
 * That split is the mechanism behind Appendix A's "silence is never
 * destructive": HR sees exactly what a truncated or filtered export would do —
 * including the list of people it does NOT mention — before it does it.
 */

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // History exposes who imported what and when — HR's own audit surface.
    if (!actor.capabilities.previewImport) return forbidden();

    const pagination = parsePagination(request.nextUrl.searchParams);

    const [batches, total] = await Promise.all([
      prisma.importBatch.findMany({
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          status: true,
          uploadedByEmail: true,
          rowsTotal: true,
          rowsCreated: true,
          rowsUpdated: true,
          rowsRejected: true,
          rowsAbsent: true,
          appliedAt: true,
          createdAt: true,
        },
      }),
      prisma.importBatch.count(),
    ]);

    return ok(paginatedResponse(batches, total, pagination));
  }),
  { id: "pms-imports-list", limit: 60, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // Preview is open to HRBP as well as Super Admin: checking a file is part
    // of running the cycle. Applying it is not (see [id]/apply).
    if (!actor.capabilities.previewImport) return forbidden();

    const form = await request.formData().catch(() => null);
    if (!form) return err("Send the workbook as multipart/form-data with a 'file' field");

    const file = form.get("file");
    if (!(file instanceof File)) return err("No file was uploaded");

    // Size is checked against the declared length BEFORE the bytes are read
    // into memory, so an oversized upload costs a header read rather than a
    // buffer allocation. The loader re-checks the real byte length, because a
    // declared size is a claim, not a fact.
    if (file.size > MAX_UPLOAD_BYTES) {
      return err(
        `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ` +
          `${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        413,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const { batchId, preview } = await previewImport({
        buffer,
        filename: file.name,
        userId: session.user.id,
        userEmail: session.user.email ?? null,
      });

      // `validRows` carries Restricted salary values and is the apply step's
      // input, not the reviewer's. It is stripped from the response for the
      // same reason it is not persisted.
      const { validRows: _internal, ...visible } = preview;
      return created({ batchId, preview: visible });
    } catch (error) {
      // A file-level problem is the operator's to fix and its message is written
      // for them; anything else is ours and must not be echoed.
      if (error instanceof ImportFileError) {
        return err(error.message, 422);
      }
      throw error;
    }
  }),
  // Deliberately tight: each call parses a workbook and reads the whole
  // employee table.
  { id: "pms-import-preview", limit: 10, windowMs: 60_000 },
);
