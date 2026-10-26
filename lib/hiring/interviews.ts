import type { HiringInterview, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { can, holdsAnywhere, isPanelOnly, type HiringActor } from "./access";
import { REQ_SELECT, type CandidateRequisition } from "./candidates";
import { HiringRuleError } from "./http";
import {
  buildRoundPlan,
  resolveBriefForRound,
  type BriefInput,
  type RoundPlanEntry,
} from "./interview-rules";
import { peopleById, personOrNull } from "./people";
import { requisitionScopeWhere, requisitionSubject } from "./scope";

/**
 * Interviews (Interview Hub `interviews.ts`, `interview-schedule.ts` and the
 * interview routes). Scope is the requisition's; a panel-only reader sees only
 * interviews they sit on. Panelists must hold `hiring.view` for the
 * requisition (otherwise they could be booked onto a panel they cannot open),
 * and a referrer can never be added to their referral's panel — but CAN be
 * removed from it (D8: Interview Hub refused the removal too).
 */

const MAX_PANEL = 12;
const MAX_ROUNDS = 4;

export type LoadedInterview = {
  iv: HiringInterview & {
    requisition: CandidateRequisition;
    candidate: { id: string; name: string; referredById: string | null };
  };
  subject: ScopeSubject;
};

export async function isPanelistOn(interviewId: string, userId: string) {
  const row = await prisma.hiringInterviewPanelist.findUnique({
    where: { interviewId_userId: { interviewId, userId } },
    select: { id: true },
  });
  return row !== null;
}

/** Load an interview the actor may `permission`; null = 404. */
export async function loadInterview(
  actor: HiringActor,
  id: string,
  permission: Permission = "hiring.view",
): Promise<LoadedInterview | null> {
  const iv = await prisma.hiringInterview.findUnique({
    where: { id },
    include: {
      requisition: { select: REQ_SELECT },
      candidate: { select: { id: true, name: true, referredById: true } },
    },
  });
  if (!iv) return null;
  const subject = await requisitionSubject(iv.requisition);
  if (!can(actor, permission, subject)) return null;
  if (
    permission === "hiring.view" &&
    isPanelOnly(actor, subject) &&
    !(await isPanelistOn(id, actor.userId))
  ) {
    return null;
  }
  return { iv, subject };
}

/** The interview filter for an actor (panel-only readers: their own panels). */
export async function interviewReadWhere(
  actor: HiringActor,
): Promise<Prisma.HiringInterviewWhereInput | null> {
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return null;
  const base: Prisma.HiringInterviewWhereInput = Object.keys(scope).length
    ? { requisition: scope }
    : {};
  const panelOnly =
    !holdsAnywhere(actor, "hiring.manage") && holdsAnywhere(actor, "hiring.panelist");
  return panelOnly ? { AND: [base, { panelists: { some: { userId: actor.userId } } }] } : base;
}

// ---------------------------------------------------------------- round plans

export async function loadRoundPlans(requisitionIds: readonly string[]) {
  const ids = [...new Set(requisitionIds.filter(Boolean))];
  const out = new Map<string, RoundPlanEntry[]>();
  if (ids.length === 0) return out;
  const [briefs, scheduled] = await Promise.all([
    prisma.hiringRoundPlan.findMany({
      where: { requisitionId: { in: ids } },
      orderBy: [{ requisitionId: "asc" }, { roundOrder: "asc" }],
      take: ids.length * MAX_ROUNDS,
    }),
    prisma.hiringInterview.groupBy({
      by: ["requisitionId", "round"],
      where: { requisitionId: { in: ids } },
      orderBy: [{ requisitionId: "asc" }, { round: "asc" }],
      take: ids.length * MAX_ROUNDS,
    }),
  ]);
  for (const id of ids) {
    out.set(
      id,
      buildRoundPlan(
        briefs.filter((b) => b.requisitionId === id) as BriefInput[],
        scheduled.filter((s) => s.requisitionId === id).map((s) => s.round),
      ),
    );
  }
  return out;
}

export async function loadRoundPlan(requisitionId: string) {
  return (await loadRoundPlans([requisitionId])).get(requisitionId) ?? [];
}

/** Replace the plan: delete dropped rounds, park kept ones, then write the new order. */
export async function replaceRoundPlan(
  requisitionId: string,
  rounds: readonly { round: string; competencies: string[]; durationMinutes: number }[],
) {
  const desired = rounds.slice(0, MAX_ROUNDS);
  const existing = await prisma.hiringRoundPlan.findMany({
    where: { requisitionId },
    select: { id: true, round: true },
    take: MAX_ROUNDS,
  });
  const byRound = new Map(existing.map((e) => [e.round as string, e.id]));
  const keep = new Set(desired.map((r) => r.round));
  await auditedTransaction(async (tx) => {
    for (const e of existing)
      if (!keep.has(e.round)) await tx.hiringRoundPlan.delete({ where: { id: e.id } });
    let park = -1;
    for (const r of desired) {
      const id = byRound.get(r.round);
      if (id) await tx.hiringRoundPlan.update({ where: { id }, data: { roundOrder: park-- } });
    }
    for (const [i, r] of desired.entries()) {
      const data = {
        roundOrder: i + 1,
        competencies: r.competencies,
        durationMinutes: r.durationMinutes,
      };
      const id = byRound.get(r.round);
      if (id) await tx.hiringRoundPlan.update({ where: { id }, data });
      else {
        await tx.hiringRoundPlan.create({
          data: { requisitionId, round: r.round as HiringInterview["round"], ...data },
        });
      }
    }
  });
}

// ---------------------------------------------------------------- panel

/** Panel members: live, holding `hiring.view` for this requisition, never the referrer. */
export async function assertPanel(
  subject: ScopeSubject,
  candidate: { referredById: string | null },
  userIds: readonly string[],
) {
  const unique = [...new Set(userIds)];
  if (unique.length > MAX_PANEL)
    throw new HiringRuleError(`A panel is limited to ${MAX_PANEL} people.`, 400);
  if (candidate.referredById && unique.includes(candidate.referredById)) {
    const name =
      (await peopleById([candidate.referredById])).get(candidate.referredById)?.name ?? "That user";
    throw new HiringRuleError(
      `${name} referred this candidate and can't sit on their panel — a referral is a conflict of interest.`,
      422,
    );
  }
  if (unique.length === 0) return unique;
  const eligible = new Set(await usersHoldingPermission("hiring.view", subject, { limit: 2000 }));
  if (unique.some((id) => !eligible.has(id))) {
    throw new HiringRuleError("Panelists need hiring access for this requisition's company.", 422);
  }
  return unique;
}

/** Make the panel exactly `userIds` (adds and removes; RSVPs of those kept are kept). */
export async function setPanel(interviewId: string, userIds: readonly string[]) {
  const existing = await prisma.hiringInterviewPanelist.findMany({
    where: { interviewId },
    select: { userId: true },
    take: 100,
  });
  const have = new Set(existing.map((e) => e.userId));
  const want = new Set(userIds);
  for (const userId of want) {
    if (!have.has(userId))
      await prisma.hiringInterviewPanelist.create({
        data: { interviewId, userId },
        select: { id: true },
      });
  }
  for (const userId of have) {
    if (!want.has(userId)) {
      await prisma.hiringInterviewPanelist.delete({
        where: { interviewId_userId: { interviewId, userId } },
      });
    }
  }
}

export async function panelOf(interviewIds: readonly string[]) {
  const rows = await prisma.hiringInterviewPanelist.findMany({
    where: { interviewId: { in: [...interviewIds] } },
    select: { interviewId: true, userId: true, confirmedAt: true },
    orderBy: { invitedAt: "asc" },
    take: interviewIds.length * MAX_PANEL,
  });
  const people = await peopleById(rows.map((r) => r.userId));
  const out = new Map<
    string,
    { userId: string; name: string; email: string | null; confirmedAt: Date | null }[]
  >();
  for (const r of rows) {
    const p = personOrNull(people, r.userId);
    const list = out.get(r.interviewId) ?? [];
    list.push({
      userId: r.userId,
      name: p?.name ?? "—",
      email: p?.email ?? null,
      confirmedAt: r.confirmedAt,
    });
    out.set(r.interviewId, list);
  }
  return out;
}

/** Decorate interview rows with their panel and their round's ordinal / length. */
export async function withPanelAndRound<
  T extends { id: string; requisitionId: string; round: string },
>(rows: T[]) {
  const [panels, plans] = await Promise.all([
    panelOf(rows.map((r) => r.id)),
    loadRoundPlans(rows.map((r) => r.requisitionId)),
  ]);
  return rows.map((r) => {
    const entry = resolveBriefForRound(plans.get(r.requisitionId) ?? [], r.round);
    return {
      ...r,
      panelists: panels.get(r.id) ?? [],
      roundOrdinal: entry.ordinal,
      roundMinutes: entry.durationMinutes,
    };
  });
}
