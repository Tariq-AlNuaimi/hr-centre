import { prisma } from "@/lib/prisma";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { isHiringAdmin, ROLE_PERMISSION, type HiringActor } from "./access";
import { applyStageChange } from "./candidate-stage";
import type { LoadedCandidate } from "./candidates";
import { HiringRuleError } from "./http";
import { peopleById, personOrNull } from "./people";
import { handToJml, muscatMidnight, sourceRefFor } from "./prejoiner";
import { handoverRefusal, handoverRoute, preboardingChecklist } from "./preboarding-rules";

/**
 * `/hiring/candidates/[id]/preboarding` (Interview Hub steps 14–15): the
 * hand-off route, the pre-boarding checklist, the joiner in JML (pre-joiner
 * record + onboarding draft) and the recorded handover. Onboarding itself is
 * JML's — Interview Hub's template tasks are not ported.
 */

async function facts(l: LoadedCandidate) {
  const c = l.cand;
  const [req, offer, idDoc, handover, eligible, joinDetail, employee] = await Promise.all([
    c.requisitionId
      ? prisma.hiringRequisition.findUnique({
          where: { id: c.requisitionId },
          select: { ownerId: true },
        })
      : null,
    prisma.hiringOffer.findFirst({
      where: { candidateId: c.id, status: "ACCEPTED" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        signedAt: true,
        signedBlobPathname: true,
        joiningDate: true,
        startDate: true,
      },
    }),
    prisma.hiringCandidateDocument.count({ where: { candidateId: c.id, kind: "ID_DOCUMENT" } }),
    prisma.hiringHandover.findUnique({ where: { candidateId: c.id } }),
    Promise.all([
      usersHoldingPermission(ROLE_PERMISSION.HR_MANAGER, l.subject, { limit: 200 }),
      usersHoldingPermission(ROLE_PERMISSION.HR_SPECIALIST, l.subject, { limit: 200 }),
    ]),
    prisma.jmlJoinDetail.findUnique({
      where: { sourceRef: sourceRefFor(c.id) },
      select: { caseId: true, case: { select: { status: true, caseRef: true } } },
    }),
    c.employeeId
      ? prisma.employee.findUnique({
          where: { id: c.employeeId },
          select: { id: true, name: true, status: true },
        })
      : null,
  ]);
  const [hrManagers, hrSpecialists] = eligible;
  const ownerId = req?.ownerId ?? null;
  const route = handoverRoute(ownerId, ownerId !== null && hrManagers.includes(ownerId));
  const checklist = preboardingChecklist({
    signedOffer: Boolean(offer?.signedAt || offer?.signedBlobPathname),
    packageConfirmed: c.packageConfirmedAt !== null,
    packageDeclined: c.packageDeclinedAt !== null,
    nationalId: idDoc > 0 || c.necEnc !== null,
    joiningDate: offer ? (offer.joiningDate ?? offer.startDate) : null,
  });
  return {
    ownerId,
    route,
    checklist,
    offer,
    handover,
    joinDetail,
    employee,
    recipients: [...new Set([...hrManagers, ...hrSpecialists])],
    hrManagers,
  };
}

export async function preboardingView(actor: HiringActor, l: LoadedCandidate) {
  const f = await facts(l);
  const people = await peopleById([
    f.ownerId,
    f.handover?.fromUserId,
    f.handover?.toUserId,
    ...f.recipients,
  ]);
  const actorIsOwnerOrAdmin = actor.userId === f.ownerId || isHiringAdmin(actor);
  return {
    candidate: { id: l.cand.id, name: l.cand.name, stage: l.cand.stage },
    route: f.route,
    owner: personOrNull(people, f.ownerId),
    checklist: f.checklist,
    // The Muscat calendar day, as UTC midnight (the client formats dates in UTC).
    joiningDate: f.offer ? muscatMidnight(f.offer.joiningDate ?? f.offer.startDate) : null,
    joiner: {
      employee: f.employee,
      caseId: f.joinDetail?.caseId ?? null,
      caseStatus: f.joinDetail?.case.status ?? null,
    },
    handover: f.handover
      ? {
          kind: f.handover.kind,
          from: personOrNull(people, f.handover.fromUserId),
          to: personOrNull(people, f.handover.toUserId),
          note: f.handover.note,
          completedAt: f.handover.completedAt,
        }
      : null,
    recipients: f.recipients
      .filter((id) => f.route !== "TRANSFERRED" || id !== f.ownerId)
      .map((id) => personOrNull(people, id))
      .filter((p): p is NonNullable<typeof p> => p !== null),
    can: {
      record: actorIsOwnerOrAdmin && !f.handover && f.route !== "UNASSIGNED",
      retryHandoff: l.cand.stage !== "REJECTED" && l.cand.stage !== "WITHDRAWN" && !f.joinDetail,
    },
  };
}

export async function recordHandover(
  actor: HiringActor,
  l: LoadedCandidate,
  body: { toUserId: string | null; note: string },
) {
  const f = await facts(l);
  const toUserId = f.route === "RETAINED" ? f.ownerId : body.toUserId;
  const refusal = handoverRefusal({
    stage: l.cand.stage,
    route: f.route,
    recorded: f.handover !== null,
    actorIsOwnerOrAdmin: actor.userId === f.ownerId || isHiringAdmin(actor),
    checklist: f.checklist,
    recipientId: toUserId,
    recipientEligible:
      f.route === "RETAINED" || (toUserId !== null && f.recipients.includes(toUserId)),
    ownerId: f.ownerId,
    note: body.note,
  });
  if (refusal) throw new HiringRuleError(refusal.message, refusal.status, refusal.code);
  await prisma.hiringHandover.create({
    data: {
      candidateId: l.cand.id,
      kind: f.route === "TRANSFERRED" ? "TRANSFERRED" : "RETAINED",
      fromUserId: f.ownerId,
      fromRole: f.hrManagers.includes(f.ownerId ?? "") ? "HR_MANAGER" : null,
      toUserId: toUserId!,
      toRole: f.hrManagers.includes(toUserId!) ? "HR_MANAGER" : "HR_SPECIALIST",
      note: body.note.trim() || null,
      recordedById: actor.userId,
    },
    select: { id: true },
  });
  if (l.cand.stage === "OFFER_ACCEPTED") {
    await applyStageChange({
      cand: l.cand,
      toStage: "PRE_ONBOARDING",
      movedById: actor.userId,
      reason: "Handover recorded (step 14)",
    });
  }
  return { recorded: true };
}

/** Try the hand-off to JML again (it is best-effort at acceptance). */
export async function retryHandoff(actor: HiringActor, l: LoadedCandidate) {
  if (!["OFFER_ACCEPTED", "PRE_ONBOARDING", "HIRED"].includes(l.cand.stage)) {
    throw new HiringRuleError(
      "The hand-off to onboarding happens once the offer is accepted.",
      409,
    );
  }
  const r = await handToJml(l.cand.id, actor.userId);
  if (!r.ok) throw new HiringRuleError(r.reason, 409, "HANDOFF_FAILED");
  return r;
}
