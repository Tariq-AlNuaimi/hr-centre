import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { PROVIDER_LIMIT, type WorkItem, type WorkProvider } from "@/lib/core/work-items";
import { APPROVAL_ROLES, ROLE_PERMISSION, actsAs, can, holdsAnywhere } from "./access";
import type { HiringActor } from "./access";
import { resolveHiringActor } from "./actor";
import { chainFromSnapshot, computeChain } from "./approval-chain";
import { approvalRoleLabel, configToChainOptions, loadApprovalConfig } from "./approval-config";
import { signableSlots } from "./jd-rules";
import { toOMRorNull } from "./money";
import { nextOfferStep, offerDecisionRefusal } from "./offer-rules";
import { delegatorActors, OFFER_SUBJECT, qualifyForRole, roundDecisions } from "./offer-round";
import { decisionStates, latestRounds } from "@/lib/core/approvals/store";
import { nextUnsignedStep } from "./requisition-rules";
import { candidateScopeWhere, requisitionScopeWhere, requisitionSubjects } from "./scope";

/**
 * Hiring in Home's "My work" (docs/blueprints/ux-p0.md, US-1): requisition,
 * JD and offer approvals whose NEXT step the viewer may decide, scorecards the
 * viewer owes, and rejection notices waiting to be sent.
 *
 * "May decide" uses the module's own rules (actsAs + the segregation-of-duties
 * refusals), counting ROLE holders only — a hiring admin can decide any step,
 * but listing every approval in the company as "waiting on you" would bury the
 * work that actually is theirs. Every read is scoped and capped; the per-item
 * checks are pure, over rows fetched in a handful of batched queries.
 */

const DAY_MS = 86_400_000;

const holdsAnApprovalRole = (actor: HiringActor) =>
  APPROVAL_ROLES.some((r) => holdsAnywhere(actor, ROLE_PERMISSION[r]));

async function requisitionApprovals(actor: HiringActor): Promise<WorkItem[]> {
  if (!holdsAnApprovalRole(actor)) return [];
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return [];
  const reqs = await prisma.hiringRequisition.findMany({
    where: { AND: [scope, { status: "PENDING_APPROVAL" }] },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PROVIDER_LIMIT,
    select: {
      id: true,
      title: true,
      entityId: true,
      departmentId: true,
      salaryBandMax: true,
      salaryCurrency: true,
    },
  });
  if (reqs.length === 0) return [];
  const ids = reqs.map((r) => r.id);
  const [subjects, entities, history, cfg] = await Promise.all([
    requisitionSubjects(reqs),
    prisma.orgEntity.findMany({
      where: { id: { in: [...new Set(reqs.map((r) => r.entityId))] } },
      select: { id: true, code: true },
      take: PROVIDER_LIMIT,
    }),
    prisma.hiringRequisitionStatusHistory.findMany({
      where: { requisitionId: { in: ids }, toStatus: "PENDING_APPROVAL" },
      orderBy: { changedAt: "desc" },
      select: { id: true, requisitionId: true, changedById: true },
      take: 500,
    }),
    loadApprovalConfig(),
  ]);
  const latest = new Map<string, (typeof history)[number]>();
  for (const h of history) if (!latest.has(h.requisitionId)) latest.set(h.requisitionId, h);
  const signed = await prisma.hiringRequisitionApproval.findMany({
    where: { submissionId: { in: [...latest.values()].map((h) => h.id) } },
    select: { submissionId: true, sequence: true, requiredRole: true, approverId: true },
    take: 500,
  });
  const code = new Map(entities.map((e) => [e.id, e.code]));
  const opts = { ...configToChainOptions(cfg), kind: "requisition" as const };
  return reqs.flatMap((r) => {
    const sub = latest.get(r.id);
    if (!sub || sub.changedById === actor.userId) return [];
    const mine = signed.filter((s) => s.submissionId === sub.id);
    if (mine.some((s) => s.approverId === actor.userId)) return [];
    const steps = computeChain(
      code.get(r.entityId),
      toOMRorNull(r.salaryBandMax, r.salaryCurrency),
      opts,
    );
    const step = nextUnsignedStep(steps, mine);
    if (!step || !actsAs(actor, step.role, subjects.get(r.id)!)) return [];
    return [
      {
        key: `hiring-req:${r.id}`,
        module: "hiring" as const,
        kind: "hiringRequisitionApproval",
        approval: true,
        params: { title: r.title, role: approvalRoleLabel(step.role) },
        dueAt: null,
        href: `/hiring/requisitions/${r.id}/approval`,
      },
    ];
  });
}

async function offerApprovals(actor: HiringActor): Promise<WorkItem[]> {
  // Delegates see the steps they may decide for someone away (ADR-094).
  const delegators = await delegatorActors(actor);
  if (!holdsAnApprovalRole(actor) && !delegators.some(holdsAnApprovalRole)) return [];
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return [];
  const offers = await prisma.hiringOffer.findMany({
    where: { status: "PENDING_APPROVAL", requisition: scope },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PROVIDER_LIMIT,
    select: {
      id: true,
      approvalChain: true,
      submittedById: true,
      candidate: { select: { name: true, referredById: true } },
      requisition: { select: { id: true, entityId: true, departmentId: true } },
    },
  });
  if (offers.length === 0) return [];
  const [subjects, rounds] = await Promise.all([
    requisitionSubjects(offers.map((o) => o.requisition)),
    latestRounds(
      OFFER_SUBJECT,
      offers.map((o) => o.id),
    ),
  ]);
  return offers.flatMap((o) => {
    const steps = chainFromSnapshot(o.approvalChain);
    const round = rounds.get(o.id);
    if (!steps || !round || round.status !== "PENDING") return [];
    const next = nextOfferStep(steps, roundDecisions(round));
    if (!next) return [];
    const subject = subjects.get(o.requisition.id)!;
    // Role holders and their delegates only — a hiring admin's proxy right is
    // not "waiting on you" (it would bury the work that actually is theirs).
    const q = qualifyForRole(actor, delegators, next.role, subject);
    if (!q || q.viaProxy) return [];
    const refusal = offerDecisionRefusal({
      actorId: actor.userId,
      actingForId: q.onBehalfOfId,
      submitterId: o.submittedById,
      referrerId: o.candidate.referredById,
      qualified: true,
      priorApproverIds: decisionStates(round)
        .filter((d) => d.action === "APPROVED" && d.sequence !== next.sequence)
        .flatMap((d) => [d.deciderId, d.onBehalfOfId].filter((x): x is string => Boolean(x))),
    });
    if (refusal) return [];
    return [
      {
        key: `hiring-offer:${o.id}`,
        module: "hiring" as const,
        kind: "hiringOfferApproval",
        params: { name: o.candidate.name, role: approvalRoleLabel(next.role) },
        dueAt: null,
        href: `/hiring/offers/${o.id}`,
        approval: true,
      },
    ];
  });
}

async function jdSignoffs(actor: HiringActor): Promise<WorkItem[]> {
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return [];
  const reqs = await prisma.hiringRequisition.findMany({
    where: { AND: [scope, { jdStatus: "AWAITING_SIGNOFF" }] },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PROVIDER_LIMIT,
    select: {
      id: true,
      title: true,
      entityId: true,
      departmentId: true,
      jdStatus: true,
      jdVersion: true,
      jdAuthorId: true,
      hiringManagerId: true,
      description: true,
    },
  });
  if (reqs.length === 0) return [];
  const [subjects, sigs] = await Promise.all([
    requisitionSubjects(reqs),
    prisma.hiringJdSignoff.findMany({
      where: { requisitionId: { in: reqs.map((r) => r.id) }, action: "SIGNED" },
      select: { requisitionId: true, version: true, signatory: true, actorId: true },
      take: 500,
    }),
  ]);
  return reqs.flatMap((r) => {
    const subject = subjects.get(r.id)!;
    const slots = signableSlots(
      {
        id: actor.userId,
        canManage: can(actor, "hiring.manage", subject),
        // Role holders only (see the file comment) — not every hiring admin.
        hrEligible: actsAs(actor, "HR_MANAGER", subject) || actsAs(actor, "HR_SPECIALIST", subject),
      },
      {
        jdStatus: r.jdStatus,
        description: r.description,
        jdAuthorId: r.jdAuthorId,
        hiringManagerId: r.hiringManagerId,
        signatures: sigs
          .filter((s) => s.requisitionId === r.id && s.version === r.jdVersion && s.signatory)
          .map((s) => ({ signatory: s.signatory!, actorId: s.actorId })),
      },
    );
    if (slots.length === 0) return [];
    return [
      {
        key: `hiring-jd:${r.id}`,
        module: "hiring" as const,
        kind: "hiringJdSignoff",
        approval: true,
        params: { title: r.title },
        dueAt: null,
        href: `/hiring/requisitions/${r.id}/jd`,
      },
    ];
  });
}

/** Interviews that have happened (or are today) and still lack my submitted scorecard. */
async function scorecardsDue(actor: HiringActor, now: Date): Promise<WorkItem[]> {
  // The score page opens only for a panelist who still reads the requisition
  // (`loadMyInterview`), so a panelist moved out of its scope is not listed.
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return [];
  const endOfToday = new Date(now.getTime() + DAY_MS);
  const rows = await prisma.hiringInterview.findMany({
    where: {
      requisition: scope,
      panelists: { some: { userId: actor.userId } },
      status: { not: "CANCELLED" },
      scheduledDate: { lte: endOfToday },
      scorecards: { none: { panelistId: actor.userId, submitted: true } },
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    take: PROVIDER_LIMIT,
    select: { id: true, scheduledDate: true, candidate: { select: { name: true } } },
  });
  return rows.map((iv) => ({
    key: `hiring-score:${iv.id}`,
    module: "hiring" as const,
    kind: "hiringScorecard",
    params: { name: iv.candidate.name },
    // Due the day after the interview.
    dueAt: iv.scheduledDate ? new Date(iv.scheduledDate.getTime() + DAY_MS).toISOString() : null,
    href: `/hiring/panel/${iv.id}/score`,
  }));
}

/** Rejection notices ready to send (step 13 is a queue a person works). One item. */
async function closeOut(actor: HiringActor, now: Date): Promise<WorkItem[]> {
  if (!holdsAnywhere(actor, "hiring.manage")) return [];
  const scope = await candidateScopeWhere(actor, "hiring.manage");
  if (scope === null) return [];
  const count = await prisma.hiringCandidate.count({
    where: {
      AND: [
        scope,
        { stage: "REJECTED", erasedAt: null, rejectionNoticeSentAt: null },
        { OR: [{ rejectionHoldUntil: null }, { rejectionHoldUntil: { lte: now } }] },
      ],
    },
  });
  if (count === 0) return [];
  return [
    {
      key: "hiring-close-out",
      module: "hiring",
      kind: "hiringCloseOut",
      params: { count },
      dueAt: null,
      href: "/hiring/close-out",
    },
  ];
}

export const hiringWorkProvider: WorkProvider = {
  module: "hiring",
  async collect(session: Session, now: Date) {
    const actor = await resolveHiringActor(session);
    const parts = await Promise.all([
      requisitionApprovals(actor),
      jdSignoffs(actor),
      offerApprovals(actor),
      scorecardsDue(actor, now),
      closeOut(actor, now),
    ]);
    const items = parts.flat();
    return { items: items.slice(0, PROVIDER_LIMIT), total: items.length };
  },
};
