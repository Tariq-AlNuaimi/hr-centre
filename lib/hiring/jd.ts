import { revalidateTag } from "next/cache";
import type { HiringJdSignatory, HiringRequisition } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { actsAs, can, canSignJdForHr, type HiringActor } from "./access";
import {
  ApprovalRefusal,
  decide,
  latestRound,
  openRound,
  type Round,
  type Tx,
} from "@/lib/core/approvals/store";
import { JD_STEP, JD_SUBJECT, roundSignatures, versionRound } from "./offer-round";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { HiringRuleError } from "./http";
import { notifyJdSubmitted } from "./notify";
import { resolveUserNotices } from "@/lib/core/notify/user-notify";
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

/**
 * Step 3 — JD sign-off service (Interview Hub `POST /api/positions/[id]/jd`).
 *
 * Rounds live in the core approvals engine (ADR-094): submitting a version
 * opens a round (`subjectVersion` = the JD version) with ONE step that needs
 * two different signatories; each signature is a decision naming its slot
 * (HIRING_MANAGER / HR); a request for changes sends the round back and bumps
 * the version. Hiring's slot rules and sentences (jd-rules.ts) run first; the
 * engine is told the module owns the drafter rule (`submitterMayDecide`).
 */

const HISTORY_LIMIT = 50;
export const CAREERS_TAG = "hiring-careers";

function jdActor(actor: HiringActor, l: LoadedRequisition): JdActor {
  return {
    id: actor.userId,
    canManage: can(actor, "hiring.manage", l.subject),
    hrEligible: canSignJdForHr(actor, l.subject),
  };
}

async function context(req: HiringRequisition, round?: Round | null): Promise<JdContext> {
  const current = versionRound(
    round === undefined ? await latestRound(JD_SUBJECT, req.id) : round,
    req.jdVersion,
  );
  return {
    jdStatus: req.jdStatus,
    description: req.description,
    jdAuthorId: req.jdAuthorId,
    hiringManagerId: req.hiringManagerId,
    requisitionStatus: req.status,
    signatures: roundSignatures(current).map((s) => ({
      signatory: s.signatory,
      actorId: s.actorId,
    })),
  };
}

export async function jdView(actor: HiringActor, l: LoadedRequisition) {
  const req = l.req;
  const [round, decisions, liveCareers] = await Promise.all([
    latestRound(JD_SUBJECT, req.id),
    prisma.approvalDecision.findMany({
      where: { request: { subjectType: JD_SUBJECT, subjectId: req.id } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        action: true,
        slot: true,
        comment: true,
        decidedAt: true,
        decider: { select: { name: true, email: true } },
        request: { select: { subjectVersion: true } },
      },
    }),
    prisma.hiringPosting.count({
      where: { requisitionId: req.id, channel: "CAREERS_PAGE", state: "LIVE" },
    }),
  ]);
  const ctx = await context(req, round);
  const signedRows = roundSignatures(versionRound(round, req.jdVersion));
  const history = decisions.map((d) => ({
    id: d.id,
    version: d.request.subjectVersion ?? 0,
    action: d.action === "APPROVED" ? "SIGNED" : "CHANGES_REQUESTED",
    signatory: (d.slot as HiringJdSignatory | null) ?? null,
    actorName: d.decider.name ?? d.decider.email,
    comment: d.comment,
    createdAt: d.decidedAt,
  }));
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
/** Who could give the HR signature: neither the submitter nor the hiring manager. */
async function hrSigners(actorId: string, l: LoadedRequisition, limit = 5): Promise<Set<string>> {
  const holders = await Promise.all(
    (["hiring.hrManager", "hiring.hrSpecialist", "hiring.configure"] as const).map((p) =>
      usersHoldingPermission(p, l.subject, { limit }),
    ),
  );
  const others = new Set(holders.flat());
  others.delete(actorId);
  others.delete(l.req.hiringManagerId);
  return others;
}

async function hasHrSigner(actorId: string, l: LoadedRequisition): Promise<boolean> {
  return (await hrSigners(actorId, l)).size > 0;
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
    await auditedTransaction(async (tx) => {
      await tx.hiringRequisition.update({
        where: { id: req.id, jdStatus: req.jdStatus, jdVersion: req.jdVersion },
        data: { jdStatus: "AWAITING_SIGNOFF", jdAuthorId: actor.userId },
      });
      await openRound(tx, {
        module: "hiring",
        subjectType: JD_SUBJECT,
        subjectId: req.id,
        subjectVersion: req.jdVersion,
        title: req.title,
        href: `/hiring/requisitions/${req.id}/jd`,
        submittedById: actor.userId,
        steps: [{ ...JD_STEP, requiredApprovals: 2 }],
      });
    });
    // UX review P0 (US-6): both signers hear it is waiting on them.
    await notifyJdSubmitted({
      requisitionId: req.id,
      title: req.title,
      version: req.jdVersion,
      recipients: [req.hiringManagerId, ...(await hrSigners(actor.userId, l, 20))],
      submitterId: actor.userId,
    });
    return;
  }
  if (body.action === "SIGN") {
    // The HR slot by someone who holds no HR role is a hiring admin's proxy signature.
    const viaProxy =
      body.signatory === "HR" &&
      !actsAs(actor, "HR_MANAGER", l.subject) &&
      !actsAs(actor, "HR_SPECIALIST", l.subject);
    const outcome = await decideJd(actor, req, {
      action: "APPROVED",
      slot: body.signatory,
      comment: body.comment,
      viaProxy,
      onClosed: (tx) =>
        tx.hiringRequisition.update({
          where: { id: req.id, jdVersion: req.jdVersion, jdStatus: "AWAITING_SIGNOFF" },
          data: { jdStatus: "APPROVED", jdApprovedAt: new Date() },
          select: { id: true },
        }),
    });
    const done = outcome === "APPROVED";
    if (done) revalidateTag(CAREERS_TAG, { expire: 0 });
    // QA D-14: the signer's notice is done; once approved, everyone's is.
    await resolveUserNotices(
      `hiring:jd:${req.id}:v${req.jdVersion}:`,
      done ? undefined : [actor.userId],
    );
    return;
  }
  await decideJd(actor, req, {
    action: "SENT_BACK",
    slot: null,
    comment: body.comment,
    viaProxy: false,
    onClosed: (tx) =>
      tx.hiringRequisition.update({
        where: { id: req.id, jdVersion: req.jdVersion, jdStatus: "AWAITING_SIGNOFF" },
        data: { jdStatus: "CHANGES_REQUESTED", jdVersion: { increment: 1 }, jdApprovedAt: null },
        select: { id: true },
      }),
  });
  revalidateTag(CAREERS_TAG, { expire: 0 });
  // Changes requested: this version will never be signed, so its notices are done.
  await resolveUserNotices(`hiring:jd:${req.id}:v${req.jdVersion}:`);
}

/**
 * One JD decision on the engine. `onClosed` runs in the decision's
 * transaction when the round closes (both signatures in, or sent back).
 */
async function decideJd(
  actor: HiringActor,
  req: HiringRequisition,
  input: {
    action: "APPROVED" | "SENT_BACK";
    slot: HiringJdSignatory | null;
    comment?: string | null;
    viaProxy: boolean;
    onClosed: (tx: Tx) => Promise<unknown>;
  },
) {
  try {
    const result = await decide({
      subjectType: JD_SUBJECT,
      subjectId: req.id,
      subjectVersion: req.jdVersion,
      actorId: actor.userId,
      action: input.action,
      comment: input.comment ?? null,
      slot: input.slot,
      submitterMayDecide: true,
      qualify: async () => ({ onBehalfOfId: null, viaProxy: input.viaProxy }),
      onOutcome: async (tx, outcome) => {
        if (outcome === "APPROVED" || outcome === "SENT_BACK") await input.onClosed(tx);
      },
    });
    return result.outcome;
  } catch (e) {
    if (!(e instanceof ApprovalRefusal)) throw e;
    if (e.code === "ALREADY")
      throw new HiringRuleError(
        "You've already signed this job description — the second signature has to come from someone else (separation of duties).",
        403,
      );
    throw new HiringRuleError(
      "This job description changed since you loaded it — reload and retry.",
      409,
    );
  }
}
