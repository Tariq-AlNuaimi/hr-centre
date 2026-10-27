import { NextRequest, NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { canViewEvidence, evidenceWriteBlockedReason } from "@/lib/pms/evidence";
import { YEAR_END_STAGE } from "@/lib/pms/rating";
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
 * A caller who may not see it gets **404, not 403**: the rest of §4.2 works
 * that way for the same reason, which is that 403 confirms the item is real.
 *
 * Who may see it: the employee, their DIRECT manager, and HR — `canViewEvidence`,
 * which is deliberately narrower than the `canViewEmployee` this route used to
 * call. That earlier version let the whole downward chain and the executive
 * viewer read the files while the blueprint and SECURITY.md §1 both claimed a
 * skip-level manager got a 404. The claim is now true because the predicate
 * exists; see the note on `canViewEvidence` for why evidence is held tighter
 * than the rating it supports.
 *
 * On serving: the redirect's `nosniff` and `no-store` bind THIS response, not
 * the cross-origin Blob response the browser then loads. The controls that
 * actually constrain the file are the private store, the pinned content type on
 * the upload token, and the five-minute single-pathname signature.
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
      // A soft-deleted KPI's evidence is not reachable either: `Kpi` is
      // soft-deletable and the FK cascade only fires on a hard delete, so
      // without this an item outlives the KPI it belongs to.
      deletedAt: true,
      participant: {
        select: {
          employeeId: true,
          goalsApprovedAt: true,
          employee: { select: { id: true, managerId: true, roleTrack: true } },
          signOffs: { where: { stageKind: YEAR_END_STAGE }, select: { party: true } },
          // §5.4 — the lock that has to apply to evidence writes too.
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
    },
  },
} as const;

async function loadVisible(id: string, actor: Awaited<ReturnType<typeof resolveActor>>) {
  const row = await prisma.kpiEvidence.findFirst({
    where: { id, deletedAt: null, kpi: { deletedAt: null } },
    select: EVIDENCE_SELECT,
  });
  if (!row) return null;
  if (!canViewEvidence(actor, row.kpi.participant.employee)) return null;
  return row;
}

/** The §5.4/§5.1/§8.3 preconditions, read off a loaded row. */
function writeRefusal(row: EvidenceRow, actor: Awaited<ReturnType<typeof resolveActor>>) {
  const { participant } = row.kpi;
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

type EvidenceRow = NonNullable<Awaited<ReturnType<typeof loadVisible>>>;

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

    const blocked = writeRefusal(row, actor);
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
 * The DIRECT line manager, and ONLY them. Not `canActOnEmployee`, which this
 * route used to call: that returns true for HR under §4.1's override, so an HR
 * user could post a note through the API that renders as "Manager's note" —
 * there is no author column to tell them apart. The screen never offered HR the
 * box, which is exactly why the hole was invisible. Attributing one person's
 * words to another is the impersonation `yearEndSignerBlockedReason` already
 * refuses for signatures, and a comment on someone's evidence is the same kind
 * of claim.
 *
 * HR's route into the record is calibration (§10), not commentary.
 */
export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const row = await loadVisible(id, actor);
    if (!row) return notFound("Evidence");

    const subject = row.kpi.participant.employee;
    if (actor.employeeId === null || subject.managerId !== actor.employeeId) {
      return notFound("Evidence");
    }
    // Frozen by the MANAGER's own signature, not the employee's. The note is
    // part of the manager's review, so their signature is what closes it —
    // keying this on the employee's would have been a regression: §7.1 has her
    // sign once she has seen the final ratings, which is AFTER the review, so a
    // manager still adding notes would have been locked out by the subject.
    if (row.kpi.participant.signOffs.some((s) => s.party === "MANAGER")) {
      return err(
        "You have signed this review, so its evidence notes are part of the signed record.",
        409,
      );
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
