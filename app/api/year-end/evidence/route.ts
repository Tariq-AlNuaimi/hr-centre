import { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import {
  MAX_EVIDENCE_BYTES,
  evidenceWriteBlockedReason,
  linkBlockedReason,
  sniffContentType,
  uploadBlockedReason,
} from "@/lib/pms/evidence";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
import {
  deleteStoredFile,
  isStorageConfigured,
  isWithinEvidencePrefix,
  signedReadUrl,
} from "@/lib/storage";
import { attachLinkSchema, uploadTokenSchema } from "@/lib/validations/evidence";

/**
 * §7.1 evidence — attaching it.
 *
 * TWO shapes on one route, because they are one act from the employee's side
 * ("add evidence to this KPI") and sharing the route keeps the permission
 * check in one place:
 *
 *  - a LINK is created outright;
 *  - a FILE asks for a client-upload token, and the row is created by Vercel's
 *    `onUploadCompleted` callback once the bytes have actually landed.
 *
 * **Client upload, not server upload.** A Vercel function caps its request body
 * at about 4.5 MB and the limit here is 10 MB, so the bytes go from the browser
 * straight to Blob storage and this function never holds them. The token is
 * where the rules bind: `maximumSizeInBytes` and `allowedContentTypes` are set
 * ON it, so a client that lies to this route still cannot complete an upload
 * that the route would have refused.
 */

/** Who the subject is, and whether their assessment is already signed. */
async function loadSubject(kpiId: string) {
  return prisma.kpi.findFirst({
    where: { id: kpiId, deletedAt: null },
    select: {
      id: true,
      participant: {
        select: {
          id: true,
          employeeId: true,
          signOffs: { where: { stageKind: YEAR_END_STAGE }, select: { party: true } },
        },
      },
      _count: { select: { evidence: { where: { deletedAt: null } } } },
    },
  });
}

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");

    // Vercel's client-upload handshake posts its own envelope. Anything else is
    // one of our two shapes.
    const isUploadHandshake =
      typeof body === "object" && body !== null && "type" in body && "payload" in body;

    if (isUploadHandshake) {
      if (!isStorageConfigured()) {
        return err(
          "File storage is not configured for this environment yet, so files cannot be " +
            "uploaded. A link can be attached instead.",
          503,
        );
      }
      try {
        const result = await handleUpload({
          request,
          body: body as HandleUploadBody,

          // EVERY rule is checked here, before a token exists. This callback is
          // the boundary: after it returns, the browser talks to Blob storage
          // directly and this process sees nothing until the upload completes.
          onBeforeGenerateToken: async (pathname, clientPayload) => {
            const parsed = uploadTokenSchema.safeParse(
              clientPayload ? JSON.parse(clientPayload) : {},
            );
            if (!parsed.success) throw new Error("That upload request is not valid.");
            const { kpiId, label, contentType, sizeBytes, filename } = parsed.data;

            const kpi = await loadSubject(kpiId);
            if (!kpi) throw new Error("Evidence not found");

            const signed = kpi.participant.signOffs.some((s) => s.party === "EMPLOYEE");
            const write = evidenceWriteBlockedReason({
              actor,
              subjectEmployeeId: kpi.participant.employeeId,
              employeeSigned: signed,
            });
            if (write) throw new Error(write.reason);

            const refusal = uploadBlockedReason({
              contentType,
              sizeBytes,
              existingCount: kpi._count.evidence,
            });
            if (refusal) throw new Error(refusal.reason);

            // The BROWSER proposes `pathname` in this protocol. Pin it to the
            // KPI we just authorised, or an employee could request a token for
            // someone else's folder and write into their evidence.
            if (!isWithinEvidencePrefix({ pathname, participantId: kpi.participant.id, kpiId })) {
              throw new Error("That upload location is not valid for this KPI.");
            }

            return {
              // PRIVATE. Written in lib/storage.ts for every other path; the
              // token protocol needs it stated here too, and it is the one
              // value in this file that must never change.
              access: "private",
              // Two uploads of the same filename must not overwrite each
              // other; the stored row keeps the displayed name either way.
              addRandomSuffix: true,
              allowedContentTypes: [contentType],
              maximumSizeInBytes: Math.min(sizeBytes, MAX_EVIDENCE_BYTES),
              // Carried through the round trip so the completion callback does
              // not have to trust anything the browser says.
              tokenPayload: JSON.stringify({
                kpiId,
                label,
                contentType,
                sizeBytes,
                filename,
                pathname,
                uploadedByEmployeeId: actor.employeeId,
                participantId: kpi.participant.id,
              }),
            };
          },

          // Fired by Vercel once the bytes are stored. The row is created HERE
          // rather than from a second browser call, so an upload cannot be
          // recorded that did not happen, and a completed upload is not lost
          // because the browser closed.
          onUploadCompleted: async ({ blob, tokenPayload }) => {
            if (!tokenPayload) return;
            const p = JSON.parse(tokenPayload) as {
              kpiId: string;
              label: string;
              contentType: string;
              sizeBytes: number;
              uploadedByEmployeeId: string;
            };

            // VERIFY THE BYTES, now that they exist.
            //
            // The token constrains the DECLARED content type, and the declared
            // type is chosen by the uploader — so up to this point nothing has
            // established that `report.pdf` is a PDF. In a client-upload flow
            // the server never sees the bytes on the way past, so this is the
            // first moment it can look, and the only honest place to make the
            // claim SECURITY.md §1 makes about these files.
            //
            // A file whose first bytes do not match what it claimed is deleted
            // and never recorded: the row is what the screens read from, so no
            // row means the upload did not happen.
            const head = await fetch(await signedReadUrl(blob.pathname), {
              headers: { Range: "bytes=0-63" },
            });
            const sniffed = sniffContentType(
              new Uint8Array(await head.arrayBuffer()),
              p.contentType,
            );
            if (sniffed !== p.contentType) {
              await deleteStoredFile(blob.pathname);
              throw new Error(
                "That file's contents do not match its type, so it was not stored. " +
                  "Re-save it in the format you meant and try again.",
              );
            }

            await auditedTransaction(async (tx) => {
              await tx.kpiEvidence.create({
                data: {
                  kpiId: p.kpiId,
                  kind: "FILE",
                  label: p.label,
                  blobPathname: blob.pathname,
                  contentType: p.contentType,
                  sizeBytes: p.sizeBytes,
                  uploadedByEmployeeId: p.uploadedByEmployeeId,
                },
                select: { id: true },
              });
            });
          },
        });
        return ok(result);
      } catch (error) {
        // Every throw above is a sentence written for the person uploading.
        return err(error instanceof Error ? error.message : "That upload was refused.", 409);
      }
    }

    // --- a LINK -------------------------------------------------------------
    const parsed = attachLinkSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { kpiId, label, url } = parsed.data;

    const kpi = await loadSubject(kpiId);
    if (!kpi) return err("Evidence not found", 404);

    const signed = kpi.participant.signOffs.some((s) => s.party === "EMPLOYEE");
    const write = evidenceWriteBlockedReason({
      actor,
      subjectEmployeeId: kpi.participant.employeeId,
      employeeSigned: signed,
    });
    if (write) return err(write.reason, write.status);

    const refusal = linkBlockedReason({ url, existingCount: kpi._count.evidence });
    if (refusal) return err(refusal.reason, refusal.status);

    const created = await auditedTransaction(async (tx) =>
      tx.kpiEvidence.create({
        data: {
          kpiId,
          kind: "LINK",
          label,
          url,
          uploadedByEmployeeId: actor.employeeId as string,
        },
        select: { id: true, kind: true, label: true, url: true, uploadedAt: true },
      }),
    );
    return ok({ evidence: created });
  }),
  { id: "pms-evidence-write", limit: 40, windowMs: 60_000 },
);

/** Evidence files are never served from here; see `[id]/route.ts`. */
export const dynamic = "force-dynamic";
