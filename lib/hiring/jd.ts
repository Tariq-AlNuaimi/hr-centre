import { revalidateTag } from "next/cache";
import type { HiringJdSignatory, HiringRequisition } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { can, canSignJdForHr, type HiringActor } from "./access";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { HiringRuleError } from "./http";
import {
  canRequestJdChanges,
  canSignJd,
  canSubmitJd,
  signableSlots,
  type JdActor,
  type JdContext,
} from "./jd-rules";
import type { LoadedRequisition } from "./requisitions";
import { isAdvertisable } from "./posting-rules";

/** Step 3 — JD sign-off service (Interview Hub `POST /api/positions/[id]/jd`). */

const HISTORY_LIMIT = 50;
export const CAREERS_TAG = "hiring-careers";

function jdActor(actor: HiringActor, l: LoadedRequisition): JdActor {
  return {
    id: actor.userId,
    canManage: can(actor, "hiring.manage", l.subject),
    hrEligible: canSignJdForHr(actor, l.subject),
  };
}

async function context(req: HiringRequisition): Promise<JdContext> {
  const signed = await prisma.hiringJdSignoff.findMany({
    where: { requisitionId: req.id, version: req.jdVersion, action: "SIGNED" },
    select: { signatory: true, actorId: true },
    take: 2,
  });
  return {
    jdStatus: req.jdStatus,
    description: req.description,
    jdAuthorId: req.jdAuthorId,
    hiringManagerId: req.hiringManagerId,
    signatures: signed.flatMap((s) =>
      s.signatory ? [{ signatory: s.signatory, actorId: s.actorId }] : [],
    ),
  };
}

export async function jdView(actor: HiringActor, l: LoadedRequisition) {
  const req = l.req;
  const [ctx, history, liveCareers, signedRows] = await Promise.all([
    context(req),
    prisma.hiringJdSignoff.findMany({
      where: { requisitionId: req.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        version: true,
        action: true,
        signatory: true,
        actorName: true,
        comment: true,
        createdAt: true,
      },
    }),
    prisma.hiringPosting.count({
      where: { requisitionId: req.id, channel: "CAREERS_PAGE", state: "LIVE" },
    }),
    prisma.hiringJdSignoff.findMany({
      where: { requisitionId: req.id, version: req.jdVersion, action: "SIGNED" },
      select: { signatory: true, actorName: true, createdAt: true },
      take: 2,
    }),
  ]);
  const a = jdActor(actor, l);
  return {
    jdVersion: req.jdVersion,
    jdStatus: req.jdStatus,
    jdTemplateTitle: req.jdTemplateTitle,
    jdApprovedAt: req.jdApprovedAt,
    description: req.description,
    competencies: req.competencies,
    advertised: isAdvertisable({ ...req, hasLiveCareersPosting: liveCareers > 0 }),
    slots: (["HIRING_MANAGER", "HR"] as HiringJdSignatory[]).map((slot) => {
      const hit = signedRows.find((s) => s.signatory === slot);
      return {
        slot,
        signed: Boolean(hit),
        actorName: hit?.actorName ?? null,
        at: hit?.createdAt ?? null,
      };
    }),
    history,
    // Only worth the lookup when this viewer could submit right now.
    hrSignerVacant: canSubmitJd(a, ctx).ok ? !(await hasHrSigner(actor.userId, l)) : false,
    can: {
      submit: canSubmitJd(a, ctx).ok,
      sign: signableSlots(a, ctx),
      requestChanges: canRequestJdChanges(a, ctx).ok,
    },
  };
}

export type JdAction =
  | { action: "SUBMIT"; comment?: string }
  | { action: "SIGN"; signatory: HiringJdSignatory; comment?: string }
  | { action: "REQUEST_CHANGES"; comment: string };

/**
 * The JD's HR signature needs someone who is neither the drafter (who becomes
 * the JD author on submit) nor the hiring manager (who signs the other slot).
 * With nobody like that, a submitted JD waits forever (UX review P0-1).
 */
async function hasHrSigner(actorId: string, l: LoadedRequisition): Promise<boolean> {
  const holders = await Promise.all(
    (["hiring.hrManager", "hiring.hrSpecialist", "hiring.configure"] as const).map((p) =>
      usersHoldingPermission(p, l.subject, { limit: 5 }),
    ),
  );
  const others = new Set(holders.flat());
  others.delete(actorId);
  others.delete(l.req.hiringManagerId);
  return others.size > 0;
}

async function assertHrSignerExists(actor: HiringActor, l: LoadedRequisition): Promise<void> {
  if (await hasHrSigner(actor.userId, l)) return;
  throw new HiringRuleError(
    "Nobody else can give this job description its HR sign-off yet (an HR manager or HR " +
      "specialist for this company), so it would wait with nobody to sign it. Ask a platform " +
      "administrator to assign the role in Admin → Roles, then submit again.",
    409,
    "VACANT_APPROVAL_STEP",
  );
}

export async function applyJdAction(actor: HiringActor, l: LoadedRequisition, body: JdAction) {
  const req = l.req;
  const ctx = await context(req);
  const a = jdActor(actor, l);
  const decision =
    body.action === "SUBMIT"
      ? canSubmitJd(a, ctx)
      : body.action === "SIGN"
        ? canSignJd(a, body.signatory, ctx)
        : canRequestJdChanges(a, ctx);
  if (!decision.ok) throw new HiringRuleError(decision.reason, 403);

  if (body.action === "SUBMIT") {
    await assertHrSignerExists(actor, l);
    await prisma.hiringRequisition.update({
      where: { id: req.id, jdStatus: req.jdStatus },
      data: { jdStatus: "AWAITING_SIGNOFF", jdAuthorId: actor.userId },
    });
    return;
  }
  if (body.action === "SIGN") {
    const approved = await auditedTransaction(async (tx) => {
      await tx.hiringJdSignoff.create({
        data: {
          requisitionId: req.id,
          version: req.jdVersion,
          action: "SIGNED",
          signatory: body.signatory,
          actorId: actor.userId,
          actorName: actor.name,
          comment: body.comment ?? null,
        },
      });
      const count = await tx.hiringJdSignoff.count({
        where: { requisitionId: req.id, version: req.jdVersion, action: "SIGNED" },
      });
      if (count < 2) return false;
      await tx.hiringRequisition.update({
        where: { id: req.id, jdVersion: req.jdVersion, jdStatus: "AWAITING_SIGNOFF" },
        data: { jdStatus: "APPROVED", jdApprovedAt: new Date() },
      });
      return true;
    });
    if (approved || (await completeIfFullySigned(req.id, req.jdVersion)))
      revalidateTag(CAREERS_TAG, "max");
    return;
  }
  await auditedTransaction(async (tx) => {
    await tx.hiringJdSignoff.create({
      data: {
        requisitionId: req.id,
        version: req.jdVersion,
        action: "CHANGES_REQUESTED",
        actorId: actor.userId,
        actorName: actor.name,
        comment: body.comment,
      },
    });
    await tx.hiringRequisition.update({
      where: { id: req.id, jdVersion: req.jdVersion, jdStatus: "AWAITING_SIGNOFF" },
      data: { jdStatus: "CHANGES_REQUESTED", jdVersion: { increment: 1 }, jdApprovedAt: null },
    });
  });
  revalidateTag(CAREERS_TAG, "max");
}

/** Closes the race where both signers commit concurrently and neither saw count = 2. */
async function completeIfFullySigned(id: string, version: number): Promise<boolean> {
  const signed = await prisma.hiringJdSignoff.count({
    where: { requisitionId: id, version, action: "SIGNED" },
  });
  if (signed < 2) return false;
  try {
    await prisma.hiringRequisition.update({
      where: { id, jdVersion: version, jdStatus: "AWAITING_SIGNOFF" },
      data: { jdStatus: "APPROVED", jdApprovedAt: new Date() },
    });
    return true;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") return false;
    throw e;
  }
}
