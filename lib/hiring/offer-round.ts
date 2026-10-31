import type { HiringApprovalRole, HiringJdSignatory } from "@/generated/prisma/client";
import { delegatorsFor, type Qualification, type Round } from "@/lib/core/approvals/store";
import { loadGrants } from "@/lib/rbac/resolve";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { actsAs, isHiringAdmin, type HiringActor } from "./access";

/**
 * Hiring offers, requisitions and JD sign-off on the core approvals engine (ADR-094). The engine keeps the
 * rounds, steps and decisions; Hiring keeps its chain rules (approval-chain.ts),
 * its role holders (RBAC permissions per step role) and its sentences.
 */

export const OFFER_SUBJECT = "hiring.offer";
/** A requisition's two-step headcount approval: one round per submission. */
export const REQUISITION_SUBJECT = "hiring.requisition";
/** A JD's two-signatory sign-off: one round per JD version (`subjectVersion`). */
export const JD_SUBJECT = "hiring.jd";

/** The actors of the people who have delegated their hiring approvals to `actor` now. */
export async function delegatorActors(actor: HiringActor): Promise<HiringActor[]> {
  const ids = await delegatorsFor(actor.userId, "hiring");
  return Promise.all(
    ids.map(async (id) => ({ userId: id, name: id, grants: await loadGrants(id) })),
  );
}

/**
 * How the actor qualifies for a step role on this record: as a holder, as the
 * delegate of a holder, or as a hiring admin (proxy). Null = not at all.
 */
export function qualifyForRole(
  actor: HiringActor,
  delegators: readonly HiringActor[],
  role: HiringApprovalRole,
  subject: ScopeSubject,
): Qualification {
  if (actsAs(actor, role, subject)) return { onBehalfOfId: null, viaProxy: false };
  const holder = delegators.find((d) => actsAs(d, role, subject));
  if (holder) return { onBehalfOfId: holder.userId, viaProxy: false };
  if (isHiringAdmin(actor)) return { onBehalfOfId: null, viaProxy: true };
  return null;
}

/** One decision per step sequence (the latest), in Hiring's shape. */
export function roundDecisions(round: Round | null) {
  if (!round || round.status === "CANCELLED") return [];
  const bySeq = new Map<number, Round["decisions"][number]>();
  for (const d of round.decisions) bySeq.set(d.step.sequence, d);
  return [...bySeq.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sequence, d]) => ({
      sequence,
      approverId: d.deciderId,
      onBehalfOfId: d.onBehalfOfId,
      action: d.action,
      comment: d.comment,
      decidedAt: d.decidedAt,
    }));
}

export const JD_STEP = { roleKey: "hiring.jd.signoff", label: "Job description sign-off" } as const;

/** The round of the JD's CURRENT version, when it went for sign-off and was not voided. */
export function versionRound(round: Round | null, version: number): Round | null {
  return round && round.subjectVersion === version && round.status !== "CANCELLED" ? round : null;
}

/** The signatures (slot + who) on a round. */
export function roundSignatures(round: Round | null) {
  return (round?.decisions ?? []).flatMap((d) =>
    d.action === "APPROVED" && d.slot
      ? [
          {
            signatory: d.slot as HiringJdSignatory,
            actorId: d.deciderId,
            actorName: d.decider.name ?? d.decider.email,
            createdAt: d.decidedAt,
          },
        ]
      : [],
  );
}
