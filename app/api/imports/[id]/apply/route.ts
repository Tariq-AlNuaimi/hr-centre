import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { ImportFileError, MAX_UPLOAD_BYTES } from "@/lib/pms/import/loaders/xlsx";
import { applyImport, ImportConflictError } from "@/lib/pms/import/run";

/**
 * Confirm and apply a previewed import — spec §3.5.
 *
 * The file is re-submitted rather than replayed from storage. Two reasons, both
 * deliberate:
 *
 *  - The parsed rows carry Restricted salary (§4.5/§11.6) and are therefore not
 *    persisted in `ImportBatch.previewJson`, which any HR user with batch access
 *    can read back.
 *  - Re-planning against live data catches an org that moved between preview and
 *    confirm — another admin adding an employee, a department renamed. The
 *    counts are compared against the reviewed batch and a divergence aborts, so
 *    what gets applied is what was actually reviewed.
 *
 * Writing is `canApplyImport` (HR Super Admin, §4.1's configure column) even
 * though previewing is open to HRBP: checking a file and reshaping the org are
 * different acts.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.applyImport) return forbidden();

    const batch = await prisma.importBatch.findUnique({
      where: { id },
      select: { id: true, status: true, filename: true },
    });
    if (!batch) return notFound("Import batch");
    if (batch.status !== "PREVIEWED") {
      return err(
        `This import is already ${batch.status.toLowerCase()}. Upload the file again for a ` +
          `fresh preview.`,
        409,
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) return err("Re-send the same workbook as multipart/form-data with a 'file' field");

    const file = form.get("file");
    if (!(file instanceof File)) return err("The workbook must be re-sent to confirm the import");
    if (file.size > MAX_UPLOAD_BYTES) return err("The file exceeds the upload limit", 413);

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      const result = await applyImport({ batchId: id, buffer });
      return ok(result);
    } catch (error) {
      if (error instanceof ImportFileError) return err(error.message, 422);
      // Every ImportConflictError message is written for the operator: the batch
      // is spent, the org moved, or the file is not the one that was reviewed.
      // Typed rather than pattern-matched on the message — the regex this
      // replaced silently turned each newly added conflict into a 500.
      if (error instanceof ImportConflictError) return err(error.message, 409);
      throw error;
    }
  }),
  { id: "pms-import-apply", limit: 10, windowMs: 60_000 },
);
