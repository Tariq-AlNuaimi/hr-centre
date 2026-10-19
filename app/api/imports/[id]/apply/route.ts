import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { enrolParticipants } from "@/lib/pms/cycle";
import { ImportFileError, MAX_UPLOAD_BYTES } from "@/lib/pms/import/loaders/xlsx";
import { applyImport, ImportConflictError } from "@/lib/pms/import/run";

// The longest write in the product: one transaction over every created, updated
// and re-parented row, and §3.5's all-or-nothing is what makes the preview worth
// reading — so it cannot be split into chunks that half-apply. The platform
// default (10 s on Vercel's smaller plans) is the real ceiling on how big an org
// this can onboard; the internal cron routes already set this for the same reason.
// `MAX_ROWS` (loaders/xlsx.ts) is derived FROM this number, so raising one without
// the other is how the cap stops meaning anything — and raising it past 60 needs a
// Vercel plan that allows it. See docs/findings-register.md.
export const maxDuration = 60;

/**
 * How many joiners the apply request enrols before handing the rest to HR's
 * manual action. The import transaction owns most of `maxDuration`, so this is
 * deliberately well short of what the budget could take: finishing an import
 * and reporting honestly beats timing out with the org reshape rolled back.
 */
const ENROL_LIMIT_PER_IMPORT = 500;

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

      // §3.5 — "New rows → create the employee, PULL THEM INTO THE CYCLE."
      //
      // Enrolment used to run only on the `DRAFT → OPEN` transition, and a
      // cycle's lifecycle is one-way, so an employee imported after the cycle
      // opened could never become a participant: no participant row, no KPI
      // set, and a manager who imported their team found goal-setting empty
      // with nothing on screen to explain it. `enrolParticipants` is
      // idempotent and was always meant to be re-run; nothing was re-running
      // it.
      //
      // OUTSIDE the import transaction, on purpose. §3.5's all-or-nothing is
      // about the org reshape — created, updated and re-parented rows are one
      // reviewed act. Enrolment is a separate, repeatable follow-on, and
      // adding N participant writes to the longest transaction in the product
      // (maxDuration 60) is how a large org's import starts timing out and
      // rolling back the part that actually matters.
      // Enrolment is a follow-on, and the import above is ALREADY COMMITTED.
      // So a failure here cannot be reported as a failed request: an error
      // response throws away `created`, `updated`, `provisioned` and — worst —
      // ADR-069's revoked-login warning, which has no other way of reaching
      // anyone. The import succeeded; what is reported is the import, with
      // enrolment flagged as the part that did not finish.
      let participantsEnrolled = 0;
      let participantsPending = 0;
      let enrolmentFailed = false;
      try {
        const open = await prisma.performanceCycle.findFirst({
          where: { status: "OPEN" },
          orderBy: { year: "desc" },
          select: { id: true },
        });
        if (open) {
          // Bounded, because this runs inside the request that just spent most
          // of its 60s on the import transaction. Whatever is left over is not
          // lost: the count comes back, HR is told, and "Enrol missing
          // employees" finishes it with the same idempotent call.
          const enrolled = await enrolParticipants(open.id, { limit: ENROL_LIMIT_PER_IMPORT });
          participantsEnrolled = enrolled.added;
          participantsPending = enrolled.remaining;
        }
      } catch (enrolError) {
        // Logged, not swallowed: without this the cause of a failed enrolment
        // (timeout, pool exhaustion, a constraint) is simply gone. Metadata
        // only — no row contents, nothing Restricted (SECURITY.md §1).
        enrolmentFailed = true;
        console.error("[import] enrolment after a committed import failed", {
          batchId: id,
          reason: enrolError instanceof Error ? enrolError.name : "unknown",
        });
      }

      return ok({ ...result, participantsEnrolled, participantsPending, enrolmentFailed });
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
