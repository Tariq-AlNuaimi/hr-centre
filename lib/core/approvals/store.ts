import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import {
  currentStep,
  decisionOutcome,
  decisionRefusal,
  delegationLive,
  type DecisionState,
  type Outcome,
  type RefusalCode,
  type StepState,
} from "./rules";

/**
 * The approvals engine's storage (ADR-094): rounds, steps, decisions and
 * delegations on `core_approval_*`. Modules call it from their own services and
 * keep their own subject status (an offer's DRAFTING / APPROVED) — `decide`
 * hands the round's outcome to the module's `onOutcome` INSIDE the same
 * audited transaction, so the decision and the subject's status commit
 * together or not at all.
 */

/** The audited transaction client modules already hold (`auditedTransaction`). */
export type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

export type OpenRoundInput = {
  module: string;
  subjectType: string;
  subjectId: string;
  /** The subject's revision this round approves (a JD version). */
  subjectVersion?: number | null;
  title: string;
  href: string;
  submittedById: string;
  excludedIds?: ReadonlyArray<string | null | undefined>;
  steps: ReadonlyArray<{ roleKey: string; label: string; requiredApprovals?: number }>;
};

/** Close any open round of the subject (resubmission, withdrawal, edit back to draft). */
export async function cancelOpenRounds(tx: Tx, subjectType: string, subjectId: string) {
  const open = await tx.approvalRequest.findMany({
    where: { subjectType, subjectId, status: "PENDING" },
    select: { id: true, steps: { select: { id: true, status: true } } },
    take: 10,
  });
  const now = new Date();
  for (const r of open) {
    await tx.approvalRequest.update({
      where: { id: r.id },
      data: { status: "CANCELLED", closedAt: now },
      select: { id: true },
    });
    for (const s of r.steps) {
      if (s.status === "CURRENT" || s.status === "WAITING")
        await tx.approvalStep.update({
          where: { id: s.id },
          data: { status: "CANCELLED" },
          select: { id: true },
        });
    }
  }
}

/** Open a new round: earlier open rounds are cancelled; step 1 becomes current. */
export async function openRound(tx: Tx, input: OpenRoundInput): Promise<string> {
  if (input.steps.length === 0) throw new Error("An approval round needs at least one step");
  await cancelOpenRounds(tx, input.subjectType, input.subjectId);
  const created = await tx.approvalRequest.create({
    data: {
      module: input.module,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion: input.subjectVersion ?? null,
      title: input.title.slice(0, 200),
      href: input.href,
      submittedById: input.submittedById,
      excludedIds: [...new Set((input.excludedIds ?? []).filter((x): x is string => Boolean(x)))],
    },
    select: { id: true },
  });
  let sequence = 0;
  for (const s of input.steps) {
    sequence += 1;
    await tx.approvalStep.create({
      data: {
        requestId: created.id,
        sequence,
        roleKey: s.roleKey,
        label: s.label,
        requiredApprovals: Math.max(1, s.requiredApprovals ?? 1),
        status: sequence === 1 ? "CURRENT" : "WAITING",
      },
      select: { id: true },
    });
  }
  return created.id;
}

const ROUND_SELECT = {
  id: true,
  module: true,
  subjectType: true,
  subjectId: true,
  subjectVersion: true,
  title: true,
  href: true,
  status: true,
  submittedById: true,
  excludedIds: true,
  createdAt: true,
  closedAt: true,
  steps: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      roleKey: true,
      label: true,
      requiredApprovals: true,
      status: true,
      decidedAt: true,
    },
  },
  decisions: {
    orderBy: { decidedAt: "asc" },
    select: {
      id: true,
      deciderId: true,
      onBehalfOfId: true,
      viaProxy: true,
      slot: true,
      action: true,
      comment: true,
      decidedAt: true,
      decider: { select: { name: true, email: true } },
      step: { select: { sequence: true } },
    },
  },
} satisfies Prisma.ApprovalRequestSelect;

export type Round = Prisma.ApprovalRequestGetPayload<{ select: typeof ROUND_SELECT }>;

/** The latest round of a subject (open or closed), or null when it never went to approval. */
export function latestRound(subjectType: string, subjectId: string): Promise<Round | null> {
  return prisma.approvalRequest.findFirst({
    where: { subjectType, subjectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ROUND_SELECT,
  });
}

/** The latest rounds of many subjects in one query (lists, inboxes). */
export async function latestRounds(
  subjectType: string,
  subjectIds: readonly string[],
): Promise<Map<string, Round>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await prisma.approvalRequest.findMany({
    where: { subjectType, subjectId: { in: [...subjectIds] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ROUND_SELECT,
    take: subjectIds.length * 5,
  });
  const out = new Map<string, Round>();
  for (const r of rows) if (!out.has(r.subjectId)) out.set(r.subjectId, r);
  return out;
}

export function decisionStates(round: Pick<Round, "decisions">): DecisionState[] {
  return round.decisions.map((d) => ({
    sequence: d.step.sequence,
    deciderId: d.deciderId,
    onBehalfOfId: d.onBehalfOfId,
    action: d.action,
  }));
}

function stepStates(round: Pick<Round, "steps">): (StepState & { id: string })[] {
  return round.steps.map((s) => ({ ...s }));
}

export class ApprovalRefusal extends Error {
  constructor(
    public readonly code: RefusalCode | "NOT_PENDING" | "NO_STEP" | "CHANGED",
    public readonly sequence: number | null = null,
  ) {
    super(code);
  }
}

/**
 * How an actor qualifies for a step: as a holder themselves, as the delegate of
 * a holder (`onBehalfOfId`), or as a module proxy (an administrator who may
 * decide any step). The module answers; the engine records which.
 */
export type Qualification = { onBehalfOfId: string | null; viaProxy: boolean } | null;

export type DecideInput = {
  subjectType: string;
  subjectId: string;
  actorId: string;
  action: DecisionState["action"];
  comment?: string | null;
  /** The named signature this decision fills on a multi-signatory step. */
  slot?: string | null;
  /** The subject revision the actor saw; a round for another revision is CHANGED. */
  subjectVersion?: number;
  /** The module enforces its own submitter rule (see `decisionRefusal`). */
  submitterMayDecide?: boolean;
  qualify: (round: Round, step: Round["steps"][number]) => Promise<Qualification>;
  onOutcome?: (tx: Tx, outcome: Outcome, round: Round) => Promise<void>;
};

/**
 * Decide the current step of the subject's open round. Throws `ApprovalRefusal`
 * (code + step) for every refusal; the module turns codes into its sentences.
 */
export async function decide(input: DecideInput) {
  const round = await latestRound(input.subjectType, input.subjectId);
  if (!round || round.status !== "PENDING") throw new ApprovalRefusal("NOT_PENDING");
  if (input.subjectVersion !== undefined && round.subjectVersion !== input.subjectVersion)
    throw new ApprovalRefusal("CHANGED");
  const steps = stepStates(round);
  const step = currentStep(steps);
  if (!step) throw new ApprovalRefusal("NO_STEP");
  const roundStep = round.steps.find((s) => s.id === step.id)!;
  const q = await input.qualify(round, roundStep);
  const decisions = decisionStates(round);
  const refusal = decisionRefusal({
    actorId: input.actorId,
    actingFor: q?.onBehalfOfId ?? null,
    submitterId: round.submittedById,
    excludedIds: round.excludedIds,
    step,
    decisions,
    qualified: q !== null,
    action: input.action,
    submitterMayDecide: input.submitterMayDecide,
  });
  if (refusal) throw new ApprovalRefusal(refusal, step.sequence);
  const outcome = decisionOutcome({
    steps,
    step,
    action: input.action,
    approvalsOnStepBefore: decisions.filter(
      (d) => d.sequence === step.sequence && d.action === "APPROVED",
    ).length,
  });
  const now = new Date();
  await auditedTransaction(async (tx) => {
    // Lock the step row, then compare: a concurrent decision or a resubmission
    // since we read loses with CHANGED rather than double-deciding.
    await tx.$queryRaw`SELECT id FROM core_approval_steps WHERE id = ${step.id} FOR UPDATE`;
    const live = await tx.approvalStep.findFirst({
      where: { id: step.id, status: "CURRENT", request: { status: "PENDING" } },
      select: { _count: { select: { decisions: true } } },
    });
    const seen = round.decisions.filter((d) => d.step.sequence === step.sequence).length;
    if (!live || live._count.decisions !== seen)
      throw new ApprovalRefusal("CHANGED", step.sequence);
    await tx.approvalDecision.create({
      data: {
        requestId: round.id,
        stepId: step.id,
        deciderId: input.actorId,
        onBehalfOfId: q?.onBehalfOfId ?? null,
        viaProxy: q?.viaProxy ?? false,
        slot: input.slot ?? null,
        action: input.action,
        comment: input.comment?.trim() || null,
        decidedAt: now,
      },
      select: { id: true },
    });
    if (outcome !== "STEP_RECORDED") {
      const stepStatus = input.action;
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: stepStatus, decidedAt: now },
        select: { id: true },
      });
    }
    if (outcome === "STEP_APPROVED") {
      const next = steps.find((s) => s.sequence > step.sequence && s.status === "WAITING");
      if (next)
        await tx.approvalStep.update({
          where: { id: next.id },
          data: { status: "CURRENT" },
          select: { id: true },
        });
    }
    if (outcome === "APPROVED" || outcome === "REJECTED" || outcome === "SENT_BACK") {
      await tx.approvalRequest.update({
        where: { id: round.id, status: "PENDING" },
        data: { status: outcome, closedAt: now },
        select: { id: true },
      });
      if (outcome !== "APPROVED") {
        for (const s of steps.filter((x) => x.status === "WAITING"))
          await tx.approvalStep.update({
            where: { id: s.id },
            data: { status: "CANCELLED" },
            select: { id: true },
          });
      }
    }
    await input.onOutcome?.(tx, outcome, round);
  });
  const next =
    outcome === "STEP_APPROVED"
      ? (round.steps.find((s) => s.sequence > step.sequence) ?? null)
      : outcome === "STEP_RECORDED"
        ? roundStep
        : null;
  return { outcome, step: roundStep, next, round };
}

// --- Delegation -------------------------------------------------------------

/** Who has delegated their approvals to `delegateId` right now (for `module`, or all modules). */
export async function delegatorsFor(
  delegateId: string,
  module: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.approvalDelegation.findMany({
    where: {
      delegateId,
      revokedAt: null,
      validFrom: { lte: now },
      validUntil: { gt: now },
      OR: [{ module: null }, { module }],
    },
    select: { delegatorId: true, validFrom: true, validUntil: true, revokedAt: true },
    take: 50,
  });
  return [...new Set(rows.filter((r) => delegationLive(r, now)).map((r) => r.delegatorId))];
}

/**
 * QA2 N-15 — the live delegates of these approvers for `module` (or all
 * modules), so a step waiting on someone who is away also reaches the person
 * deciding for them.
 */
export async function delegatesOf(
  delegatorIds: readonly string[],
  module: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (delegatorIds.length === 0) return [];
  const rows = await prisma.approvalDelegation.findMany({
    where: {
      delegatorId: { in: [...delegatorIds] },
      revokedAt: null,
      validFrom: { lte: now },
      validUntil: { gt: now },
      OR: [{ module: null }, { module }],
    },
    select: { delegateId: true, validFrom: true, validUntil: true, revokedAt: true },
    take: 50,
  });
  return [...new Set(rows.filter((r) => delegationLive(r, now)).map((r) => r.delegateId))];
}

const DELEGATION_SELECT = {
  id: true,
  delegatorId: true,
  delegateId: true,
  module: true,
  validFrom: true,
  validUntil: true,
  reason: true,
  revokedAt: true,
  delegator: { select: { name: true, email: true } },
  delegate: { select: { name: true, email: true } },
} satisfies Prisma.ApprovalDelegationSelect;

/** The delegations a user gave and received that have not ended. */
export function delegationsOf(userId: string, now: Date = new Date()) {
  return prisma.approvalDelegation.findMany({
    where: {
      OR: [{ delegatorId: userId }, { delegateId: userId }],
      revokedAt: null,
      validUntil: { gt: now },
    },
    orderBy: { validFrom: "asc" },
    select: DELEGATION_SELECT,
    take: 50,
  });
}

export async function createDelegation(input: {
  delegatorId: string;
  delegateId: string;
  module: string | null;
  validFrom: Date;
  validUntil: Date;
  reason?: string | null;
}) {
  return prisma.approvalDelegation.create({
    data: { ...input, reason: input.reason?.trim() || null },
    select: DELEGATION_SELECT,
  });
}

/** Revoke one of the caller's own delegations. False when it is not theirs or already over. */
export async function revokeDelegation(id: string, delegatorId: string): Promise<boolean> {
  const row = await prisma.approvalDelegation.findFirst({
    where: { id, delegatorId, revokedAt: null },
    select: { id: true },
  });
  if (!row) return false;
  await prisma.approvalDelegation.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
    select: { id: true },
  });
  return true;
}
