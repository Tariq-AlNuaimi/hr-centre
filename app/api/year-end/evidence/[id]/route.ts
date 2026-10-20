import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { evidenceWriteBlockedReason } from "@/lib/pms/evidence";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canActOnEmployee, canViewEmployee } from "@/lib/pms/permissions";
import { signedReadUrl, StorageNotConfiguredError } from "@/lib/storage";
import { evidenceCommentSchema } from "@/lib/validations/evidence";

/**
 * §7.1 evidence — opening one item, removing one, commenting on one.
 *
 * **The read is the interesting one.** There is no public URL for an evidence
 * file: the store is private, so the only way to bytes is a signed URL, and
 * the only way to a signed URL is this route — which runs §4.2's visibility
 * check FIRST and signs afterwards. The signature is the last step of an
 * authorised read, never the authorisation.
 *
 * A caller outside the subject's chain gets **404, not 403**: the rest of §4.2
 * works that way for the same reason, which is that 403 confirms the item is
 * real. Who may see it: the employee, their direct manager, and HR — the same
 * `canViewEmployee` the whole module uses, so there is no second definition of
 * "may see" to drift out of step.
 */

const EVIDENCE_SELECT = {
  id: true,
  kind: true,
  label: true,
  blobPathname: true,
  contentType: true,
  url: true,
  deletedAt: true,
  kpi: {
    select: {
      id: true,
      participant: {
        select: {
          employeeId: true,
          employee: { select: { id: true, managerId: true } },
          signOffs: { where: { stageKind: YEAR_END_STAGE }, select: { party: true } },
        },
      },
    },
  },
} as const;

async function loadVisible(id: string, actor: Awaited<ReturnType<typeof resolveActor>>) {
  const row = await prisma.kpiEvidence.findFirst({
    where: { id, deletedAt: null },
    select: EVIDENCE_SELECT,
  });
  if (!row) return null;
  const descendants = await visibilityDescendants(actor);
  if (!canViewEmployee(actor, row.kpi.participant.employeeId, descendants)) return null;
  return row;
}

/** Open the item: a redirect to a 5-minute signed URL, or the link itself. */
export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const row = await loadVisible(id, actor);
    if (!row) return notFound("Evidence");

    if (row.kind === "LINK") return ok({ url: row.url });
    if (!row.blobPathname) return notFound("Evidence");

    try {
      const url = await signedReadUrl(row.blobPathname);
      // 302 to a URL that expires in five minutes. Not proxied through this
      // function: a 10 MB body would blow the response budget, and the signed
      // URL is already scoped to one pathname and the `get` operation alone.
      const res = NextResponse.redirect(url, 302);
      // Belt and braces for the browser that follows it: an uploaded file must
      // never render as a page in this origin.
      res.headers.set("X-Content-Type-Options", "nosniff");
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) return err(error.message, 503);
      throw error;
    }
  }),
  { id: "pms-evidence-read", limit: 120, windowMs: 60_000 },
);

/**
 * Remove an item — the employee's own, before they sign.
 *
 * Soft delete. The bytes stay until a retention decision is made (an open
 * question in the blueprint): what is withdrawn before signing is still part of
 * how the assessment was built, and §6.3's principle — archived, never
 * overwritten — reads across. The audit row is what requirement 5 asks for.
 */
export const DELETE = withRateLimit(
  withAuth(async (_request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const row = await loadVisible(id, actor);
    if (!row) return notFound("Evidence");

    const signed = row.kpi.participant.signOffs.some((s) => s.party === "EMPLOYEE");
    const blocked = evidenceWriteBlockedReason({
      actor,
      subjectEmployeeId: row.kpi.participant.employeeId,
      employeeSigned: signed,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    await auditedTransaction(async (tx) => {
      await tx.kpiEvidence.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: actor.employeeId },
        select: { id: true },
      });
    });
    return ok({ removed: id });
  }),
  { id: "pms-evidence-write", limit: 40, windowMs: 60_000 },
);

/**
 * The manager's note on one item (requirement 4).
 *
 * The DIRECT line manager, via `canActOnEmployee` — the same authority §7.1
 * gives them to review the rating. HR can see evidence but does not annotate
 * it: the note is part of the manager's review, and HR's route into the record
 * is calibration, not commentary.
 */
export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const row = await loadVisible(id, actor);
    if (!row) return notFound("Evidence");

    if (!canActOnEmployee(actor, row.kpi.participant.employee)) {
      return notFound("Evidence");
    }

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = evidenceCommentSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }

    const updated = await auditedTransaction(async (tx) =>
      tx.kpiEvidence.update({
        where: { id },
        // Comment and timestamp together — the CHECK constraint refuses half of
        // the pair, and this is the writer that must not try.
        data: { managerComment: parsed.data.comment, managerCommentAt: new Date() },
        select: { id: true, managerComment: true, managerCommentAt: true },
      }),
    );
    return ok({ evidence: updated });
  }),
  { id: "pms-evidence-write", limit: 40, windowMs: 60_000 },
);
