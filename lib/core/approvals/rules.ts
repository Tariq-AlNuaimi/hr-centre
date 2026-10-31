/**
 * The approval engine's rules (ADR-094) — pure, so every module and every test
 * asks the same questions. Storage is `./store.ts`; who HOLDS a step's role is
 * the module's answer (role-holder resolution stays with the module's RBAC
 * permissions), passed in as `qualifies`.
 */

export type StepState = {
  sequence: number;
  roleKey: string;
  requiredApprovals: number;
  status: "WAITING" | "CURRENT" | "APPROVED" | "REJECTED" | "SENT_BACK" | "CANCELLED";
};

export type DecisionState = {
  sequence: number;
  deciderId: string;
  onBehalfOfId: string | null;
  action: "APPROVED" | "REJECTED" | "SENT_BACK";
};

/** The step waiting for a decision: the first one not yet approved (in sequence order). */
export function currentStep<T extends StepState>(steps: readonly T[]): T | undefined {
  return [...steps].sort((a, b) => a.sequence - b.sequence).find((s) => s.status !== "APPROVED");
}

/**
 * Why `actorId` may not decide `step`, as a code the module turns into its own
 * sentence — or null when they may.
 *
 *   NO_SUBMITTER   the round has no recorded submitter (cannot prove SoD)
 *   SUBMITTER      self-approval ban: the submitter never decides their own round
 *   EXCLUDED       a module-named conflict (e.g. the candidate's referrer)
 *   PRIOR_STEP     the actor (or the holder they act for) approved an earlier step
 *                  of this round — one person, one step
 *   ALREADY        the actor already approved this step (two-holder steps need two
 *                  people) — they may still turn it down (reject / send back)
 *   NOT_QUALIFIED  neither the actor, a holder they are a delegate for, nor a proxy
 *
 * `submitterMayDecide` is for a module whose own rule about the submitter is
 * narrower than a round-wide ban (a JD's drafter may sign the hiring-manager
 * slot, never the HR one): the engine then skips NO_SUBMITTER and SUBMITTER and
 * the module enforces its rule before calling `decide`.
 */
export type RefusalCode =
  "NO_SUBMITTER" | "SUBMITTER" | "EXCLUDED" | "PRIOR_STEP" | "ALREADY" | "NOT_QUALIFIED";

export function decisionRefusal(input: {
  actorId: string;
  /** Whom the actor would act for (themselves, or the delegator), when qualified. */
  actingFor: string | null;
  submitterId: string | null;
  excludedIds: readonly string[];
  step: Pick<StepState, "sequence">;
  decisions: readonly DecisionState[];
  qualified: boolean;
  /** The decision being made; ALREADY guards approvals only. Defaults to an approval. */
  action?: DecisionState["action"];
  submitterMayDecide?: boolean;
}): RefusalCode | null {
  const people = new Set([input.actorId, input.actingFor].filter((x): x is string => Boolean(x)));
  if (!input.submitterMayDecide) {
    if (!input.submitterId) return "NO_SUBMITTER";
    if (people.has(input.submitterId)) return "SUBMITTER";
  }
  if (input.excludedIds.some((id) => people.has(id))) return "EXCLUDED";
  const approvedEarlier = input.decisions.filter(
    (d) => d.action === "APPROVED" && d.sequence !== input.step.sequence,
  );
  if (approvedEarlier.some((d) => people.has(d.deciderId) || people.has(d.onBehalfOfId ?? "")))
    return "PRIOR_STEP";
  const onThisStep = input.decisions.filter(
    (d) => d.sequence === input.step.sequence && d.action === "APPROVED",
  );
  if (
    (input.action ?? "APPROVED") === "APPROVED" &&
    onThisStep.some((d) => people.has(d.deciderId) || people.has(d.onBehalfOfId ?? ""))
  )
    return "ALREADY";
  if (!input.qualified) return "NOT_QUALIFIED";
  return null;
}

export type Outcome = "STEP_RECORDED" | "STEP_APPROVED" | "APPROVED" | "REJECTED" | "SENT_BACK";

/**
 * What a decision does to the round. A rejection or send-back closes it at
 * once; an approval passes the step when it has `requiredApprovals` distinct
 * approvers, and approves the round when it was the last step.
 */
export function decisionOutcome(input: {
  steps: readonly StepState[];
  step: StepState;
  action: DecisionState["action"];
  approvalsOnStepBefore: number;
}): Outcome {
  if (input.action === "REJECTED") return "REJECTED";
  if (input.action === "SENT_BACK") return "SENT_BACK";
  if (input.approvalsOnStepBefore + 1 < Math.max(1, input.step.requiredApprovals))
    return "STEP_RECORDED";
  const last = Math.max(...input.steps.map((s) => s.sequence));
  return input.step.sequence === last ? "APPROVED" : "STEP_APPROVED";
}

/**
 * Steps nobody could decide: no holder left once the people who may not decide
 * (the submitter, a referrer) are removed, or fewer than a two-holder step
 * needs. Submission refuses such a chain instead of letting it wait forever.
 */
export function vacantSteps<T extends { holderIds: readonly string[]; requiredApprovals?: number }>(
  steps: readonly T[],
  exclude: ReadonlyArray<string | null | undefined> = [],
): T[] {
  const out = new Set(exclude.filter((x): x is string => Boolean(x)));
  return steps.filter(
    (s) =>
      new Set(s.holderIds.filter((id) => !out.has(id))).size <
      Math.max(1, s.requiredApprovals ?? 1),
  );
}

/** Is a delegation live at `now`? */
export function delegationLive(
  d: { validFrom: Date; validUntil: Date; revokedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return d.revokedAt === null && d.validFrom <= now && now < d.validUntil;
}
