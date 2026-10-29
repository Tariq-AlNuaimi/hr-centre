import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { randomUUID } from "node:crypto";
import {
  ALLOWED_EVIDENCE_TYPES,
  type AllowedContentType,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_PER_KPI,
  evidenceWriteBlockedReason,
  linkBlockedReason,
  sniffContentType,
  uploadBlockedReason,
} from "@/lib/pms/evidence";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
import {
  deleteStoredFile,
  evidencePrefix,
  isStorageConfigured,
  isWithinEvidencePrefix,
  readStoredHead,
} from "@/lib/storage";
import {
  attachLinkSchema,
  confirmUploadSchema,
  uploadPreflightSchema,
  uploadTokenSchema,
} from "@/lib/validations/evidence";

/**
 * §7.1 evidence — attaching it.
 *
 * THREE shapes on one POST, because they are one act from the employee's side
 * ("add evidence to this KPI") and one route keeps the permission check in one
 * place rather than three:
 *
 *  1. a LINK — created outright;
 *  2. an upload HANDSHAKE — Vercel's client-upload protocol asking for a token;
 *  3. a CONFIRM — the browser reporting that the bytes landed, which is where
 *     the row is created.
 *
 * **Client upload, not server upload.** A Vercel function caps its request body
 * at about 4.5 MB and the limit here is 10 MB, so the bytes go from the browser
 * straight to Blob storage and this function never holds them. The token is
 * where the rules bind: `maximumSizeInBytes` and `allowedContentTypes` are set
 * ON it, so a client that lies to this route still cannot complete an upload
 * that the route would have refused.
 *
 * ## Why the row is created by shape 3 and not by Vercel's callback
 *
 * The first version of this route created the row in `handleUpload`'s
 * `onUploadCompleted`, which is the shape Vercel documents. It could never have
 * worked here, and the reason is worth keeping: that callback is a
 * server-to-server POST from Vercel carrying no session cookie, and this
 * application answers `401` to any unauthenticated `/api/*` request — in
 * `middleware.ts` first, and then again in `withAuth`. The row was never
 * created, the byte check never ran, and the only visible symptom was an empty
 * evidence list.
 *
 * Making it work would have meant a PUBLIC API path (an Ask-before item in
 * CLAUDE.md) carrying a callback authenticated only by Vercel's own HMAC — a
 * new unauthenticated surface, for a feature whose whole point is confidential
 * files. Instead the browser calls back here, authenticated as the employee,
 * and the server re-checks every rule from the database before writing. The
 * trade is explicit: if the browser dies between the upload finishing and the
 * confirm landing, the bytes are orphaned in the store with no row pointing at
 * them. An orphan blob is invisible to every screen (the row is what the
 * screens read) and is a cleanup job; an orphan ROW would be a lie about the
 * record, and that is the direction that matters.
 */

/** Everything the three shapes need to judge a write, in one query. */
async function loadSubject(kpiId: string) {
  return prisma.kpi.findFirst({
    where: { id: kpiId, deletedAt: null },
    select: {
      id: true,
      participant: {
        select: {
          id: true,
          employeeId: true,
          goalsApprovedAt: true,
          employee: { select: { id: true, managerId: true, roleTrack: true } },
          signOffs: { where: { stageKind: YEAR_END_STAGE }, select: { party: true } },
          // §5.4 — the deadline lock applies to evidence, not only to ratings.
          cycle: {
            select: {
              status: true,
              stages: {
                where: { kind: YEAR_END_STAGE },
                select: { kind: true, opensAt: true, deadline: true, graceDays: true },
              },
            },
          },
        },
      },
      _count: { select: { evidence: { where: { deletedAt: null } } } },
    },
  });
}

type Subject = NonNullable<Awaited<ReturnType<typeof loadSubject>>>;

/** §8.3 / §5.1 / §5.4 / owner-only — the same verdict for all three shapes. */
function writeRefusal(kpi: Subject, actor: Awaited<ReturnType<typeof resolveActor>>) {
  const { participant } = kpi;
  return evidenceWriteBlockedReason({
    actor,
    subjectEmployeeId: participant.employeeId,
    employeeSigned: participant.signOffs.some((s) => s.party === "EMPLOYEE"),
    roleTrack: participant.employee.roleTrack,
    goalsApprovedAt: participant.goalsApprovedAt,
    stage: participant.cycle.stages[0] ?? null,
    cycleStatus: participant.cycle.status,
    now: new Date(),
  });
}

const STORAGE_UNCONFIGURED =
  "File storage is not configured for this environment yet, so files cannot be uploaded. " +
  "A link can be attached instead.";

type Actor = Awaited<ReturnType<typeof resolveActor>>;

/**
 * Shape 0 — "may I upload this, and where to?", answered BEFORE any bytes move.
 *
 * Two jobs, both learned the hard way.
 *
 * **It makes a refusal legible.** Every rule below is also enforced in the
 * token callback, but a refusal thrown there travels back through the Blob
 * SDK, which surfaces its own error rather than our sentence and its status.
 * The operator could not see why an upload did nothing — "the file picker opens
 * and nothing happens" — and could not read a browser console either. Asking
 * first means the exact reason and HTTP status reach the screen.
 *
 * **It ends the pathname disagreement structurally.** The server pins uploads
 * to `year-end/<participantId>/<kpiId>/` and the BROWSER proposes the path, so
 * for one release the client sent a prefix the pin could never accept and every
 * upload was refused — two files, both correct in isolation, with nothing
 * type-checking one against the other. Now the server RETURNS the pathname it
 * will authorise and the client echoes it back. There is one author of that
 * string, so there is nothing left to disagree about. The token callback still
 * re-checks it: a client may lie, and this reply is advice, not authority.
 */
async function handlePreflight(body: unknown, actor: Actor) {
  const parsed = uploadPreflightSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
  }
  const { kpiId, contentType, sizeBytes } = parsed.data;

  // Reported rather than thrown: the screen needs to tell the operator that
  // files are unavailable in THIS environment while links still work, and
  // "storage is not configured" is a deployment state, not a user error.
  if (!isStorageConfigured()) return err(STORAGE_UNCONFIGURED, 503);

  const kpi = await loadSubject(kpiId);
  if (!kpi) return err("Evidence not found", 404);

  const write = writeRefusal(kpi, actor);
  if (write) return err(write.reason, write.status);

  const refusal = uploadBlockedReason({
    contentType,
    sizeBytes,
    existingCount: kpi._count.evidence,
  });
  if (refusal) return err(refusal.reason, refusal.status);

  // The extension is cosmetic — the stored name is a UUID so that a filename
  // with a space, a slash or an Arabic character cannot fail the pin, and the
  // real name travels in `label`. It is kept only so a downloaded file opens in
  // the right application.
  const ext = ALLOWED_EVIDENCE_TYPES[contentType as AllowedContentType][0];
  const pathname = `${evidencePrefix(kpi.participant.id, kpiId)}${randomUUID()}.${ext}`;

  return ok({ pathname, remaining: MAX_EVIDENCE_PER_KPI - kpi._count.evidence });
}

/** Shape 2 — mint a client-upload token, with every rule checked first. */
async function handleHandshake(request: NextRequest, body: unknown, actor: Actor) {
  if (!isStorageConfigured()) return err(STORAGE_UNCONFIGURED, 503);
  try {
    const result = await handleUpload({
      request,
      body: body as HandleUploadBody,

      // EVERY rule is checked here, before a token exists. After this
      // returns, the browser talks to Blob storage directly and this
      // process sees nothing until the confirm arrives.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const parsed = uploadTokenSchema.safeParse(clientPayload ? JSON.parse(clientPayload) : {});
        if (!parsed.success) throw new Error("That upload request is not valid.");
        // `label` is deliberately not read here: the confirm carries the
        // display name, and the token only needs what constrains the upload.
        const { kpiId, contentType, sizeBytes } = parsed.data;

        const kpi = await loadSubject(kpiId);
        if (!kpi) throw new Error("Evidence not found");

        const write = writeRefusal(kpi, actor);
        if (write) throw new Error(write.reason);

        const refusal = uploadBlockedReason({
          contentType,
          sizeBytes,
          existingCount: kpi._count.evidence,
        });
        if (refusal) throw new Error(refusal.reason);

        // The BROWSER proposes `pathname` in this protocol — the server
        // cannot substitute one. So it is pinned to the KPI just
        // authorised, or an employee could request a token for someone
        // else's folder and write into their evidence.
        //
        // This check is why no file has ever uploaded: the client was
        // sending `year-end/pending/<filename>`, which can never satisfy
        // it. The pin was right and the caller was wrong — the client now
        // builds the authorised prefix, and a filename with a space or an
        // Arabic character no longer fails the path at all, because the
        // stored basename is a UUID and the real name lives in `label`.
        if (!isWithinEvidencePrefix({ pathname, participantId: kpi.participant.id, kpiId })) {
          throw new Error("That upload location is not valid for this KPI.");
        }

        return {
          // PRIVATE. Written in lib/storage.ts for every other path; the
          // token protocol needs it stated here too, and it is the one
          // value in this file that must never change.
          access: "private",
          // OFF, now that the preflight issues a server-generated UUID path.
          // It was on to guarantee uniqueness, which the UUID already does —
          // and leaving it on means the stored pathname is NOT the one that was
          // authorised, so the confirm has to accept whatever shape the suffix
          // takes. That shape is one more thing this code cannot verify from a
          // container with no route to Vercel. Off, the pathname the client
          // confirms is exactly the pathname the server handed out.
          addRandomSuffix: false,
          allowedContentTypes: [contentType],
          maximumSizeInBytes: Math.min(sizeBytes, MAX_EVIDENCE_BYTES),
          // No `tokenPayload`: it existed to carry state into
          // `onUploadCompleted`, and nothing reads it now that the browser
          // confirms instead. The confirm re-reads every field from the
          // database, which is the stronger version of the same idea.
        };
      },

      // Deliberately absent: `onUploadCompleted`. See the note at the top
      // of this file — it arrives unauthenticated and this application
      // answers 401, so a row created there was never created at all.
    });
    // RAW JSON, not `ok()`. The client SDK reads `clientToken` at the top
    // level of the body; `ok()` would nest it under `data` and the upload
    // would fail with a token error that names nothing useful.
    return NextResponse.json(result);
  } catch (error) {
    // Every throw above is a sentence written for the person uploading.
    return err(error instanceof Error ? error.message : "That upload was refused.", 409);
  }
}

/** Shape 3 — the browser reports the bytes landed; this creates the row. */
async function handleConfirm(body: unknown, actor: Actor) {
  if (!isStorageConfigured()) return err(STORAGE_UNCONFIGURED, 503);
  const parsed = confirmUploadSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
  }
  const { kpiId, pathname, label, contentType } = parsed.data;

  const kpi = await loadSubject(kpiId);
  if (!kpi) return err("Evidence not found", 404);

  // Re-checked from the database, not taken from the handshake. A token
  // minted a minute ago says nothing about now: the employee may have
  // signed in between, the deadline may have passed, and two tabs that each
  // passed the cap at nine items would otherwise both land an eleventh.
  const write = writeRefusal(kpi, actor);
  if (write) return err(write.reason, write.status);

  const refusal = uploadBlockedReason({
    contentType,
    sizeBytes: parsed.data.sizeBytes,
    existingCount: kpi._count.evidence,
  });
  if (refusal) return err(refusal.reason, refusal.status);

  if (!isWithinEvidencePrefix({ pathname, participantId: kpi.participant.id, kpiId })) {
    return err("That upload location is not valid for this KPI.", 409);
  }

  // Replay guard. Without it, re-posting one confirm creates a second row
  // for one file — and after a soft delete, a third.
  const already = await prisma.kpiEvidence.findFirst({
    where: { blobPathname: pathname },
    select: { id: true },
  });
  if (already) return ok({ evidence: already });

  // VERIFY THE BYTES, now that they exist.
  //
  // The token constrains the DECLARED content type, and the declared type is
  // chosen by the uploader — so until this point nothing has established that
  // `report.pdf` is a PDF. This is the first moment the server can look, and
  // the only honest place to make the claim SECURITY.md §1 makes about these
  // files. A file whose first bytes do not match what it claimed is deleted and
  // never recorded: no row means it did not happen.
  const head = await readStoredHead(pathname);
  if (!head) {
    return err(
      "That file could not be read back from storage after uploading, so it was not " +
        "recorded. Please try attaching it again.",
      502,
    );
  }
  if (sniffContentType(head.bytes, contentType) !== contentType) {
    await deleteStoredFile(pathname);
    return err(
      "That file's contents do not match its type, so it was not stored. Re-save it in the " +
        "format you meant and try again.",
      415,
    );
  }
  if (head.sizeBytes > MAX_EVIDENCE_BYTES) {
    await deleteStoredFile(pathname);
    return err("That file is larger than the 10 MB per file limit, so it was not stored.", 413);
  }

  try {
    const created = await auditedTransaction(async (tx) =>
      tx.kpiEvidence.create({
        data: {
          kpiId,
          kind: "FILE",
          label,
          blobPathname: pathname,
          contentType,
          // The stored length, not the one the browser claimed.
          sizeBytes: head.sizeBytes,
          uploadedByEmployeeId: actor.employeeId as string,
        },
        select: { id: true, kind: true, label: true, sizeBytes: true, uploadedAt: true },
      }),
    );
    return ok({ evidence: created });
  } catch (error) {
    // The row is what makes the bytes part of the record. If it cannot be
    // written, the bytes do not get to stay.
    await deleteStoredFile(pathname).catch(() => {});
    throw error;
  }
}

/** Shape 1 — a link, created outright. */
async function handleLink(body: unknown, actor: Actor) {
  const parsed = attachLinkSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
  }
  const { kpiId, label, url } = parsed.data;

  const kpi = await loadSubject(kpiId);
  if (!kpi) return err("Evidence not found", 404);

  const write = writeRefusal(kpi, actor);
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
}

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const shape =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

    // Vercel's client-upload protocol posts `{ type, payload }`; our confirm
    // carries a `pathname`; anything else is a link.
    if ("type" in shape && "payload" in shape) return handleHandshake(request, body, actor);
    if (shape.preflight === true) return handlePreflight(body, actor);
    if ("pathname" in shape) return handleConfirm(body, actor);
    return handleLink(body, actor);
  }),
  { id: "pms-evidence-write", limit: 40, windowMs: 60_000 },
);

/** Evidence files are never served from here; see `[id]/route.ts`. */
export const dynamic = "force-dynamic";
