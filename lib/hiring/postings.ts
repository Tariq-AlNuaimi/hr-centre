import { revalidateTag } from "next/cache";
import type { HiringPostingChannel } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { CAREERS_TAG } from "./jd";
import { peopleById } from "./people";
import { buildChannelRows, canPost, daysBetween, omaniPreferredForced } from "./posting-rules";
import type { LoadedRequisition } from "./requisitions";

/** Step 4 — the posting console (Interview Hub `loadPostingConsole` + postings route). */

export async function postingConsole(l: LoadedRequisition) {
  const id = l.req.id;
  const [postings, grouped, opened, sourced, namedReferrals] = await Promise.all([
    prisma.hiringPosting.findMany({ where: { requisitionId: id }, take: 6 }),
    prisma.hiringCandidate.groupBy({
      by: ["source"],
      where: { requisitionId: id },
      _count: { _all: true },
      orderBy: { source: "asc" },
      take: 20,
    }),
    prisma.hiringRequisitionStatusHistory.findFirst({
      where: { requisitionId: id, toStatus: "OPEN" },
      orderBy: { changedAt: "asc" },
      select: { changedAt: true },
    }),
    prisma.hiringCandidate.findMany({
      where: { requisitionId: id, source: { in: ["DIRECT_SOURCING", "REFERRAL", "AGENCY"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, name: true, currentEmployer: true, source: true, agencyName: true },
    }),
    prisma.hiringCandidate.count({
      where: { requisitionId: id, source: "REFERRAL", referredById: { not: null } },
    }),
  ]);
  const people = await peopleById(postings.map((p) => p.postedById));
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.source] = g._count._all;
  const rows = buildChannelRows(
    postings.map((p) => ({
      channel: p.channel,
      live: p.state === "LIVE",
      detail: p.detail,
      omaniPreferred: p.omaniPreferred,
      postedAt: p.postedAt.toISOString(),
      postedByName: p.postedById ? (people.get(p.postedById)?.name ?? null) : null,
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
    })),
    counts,
  );
  return {
    gate: canPost(l.req.status, l.req.jdApprovedAt),
    rows,
    stats: {
      liveCount: rows.filter((r) => r.live).length,
      applicants: Object.values(counts).reduce((a, b) => a + b, 0),
      sourcedDirectly: counts.DIRECT_SOURCING ?? 0,
      referrals: counts.REFERRAL ?? 0,
      referralsWithNamedReferrer: namedReferrals,
      daysOpen: opened ? daysBetween(opened.changedAt, new Date()) : null,
    },
    sourced,
  };
}

/** Post (or re-post) a channel: the (requisition, channel) row flips back to LIVE. */
export async function postChannel(
  actor: HiringActor,
  l: LoadedRequisition,
  input: { channel: HiringPostingChannel; detail?: string; omaniPreferred?: boolean },
) {
  const gate = canPost(l.req.status, l.req.jdApprovedAt);
  if (!gate.ok) throw new HiringRuleError(gate.reason, 409);
  const omaniPreferred = omaniPreferredForced(input.channel) || Boolean(input.omaniPreferred);
  const data = {
    state: "LIVE" as const,
    detail: input.detail?.trim() || null,
    omaniPreferred,
    postedAt: new Date(),
    postedById: actor.userId,
    withdrawnAt: null,
    withdrawnById: null,
  };
  const existing = await prisma.hiringPosting.findUnique({
    where: { requisitionId_channel: { requisitionId: l.req.id, channel: input.channel } },
    select: { id: true },
  });
  if (existing) await prisma.hiringPosting.update({ where: { id: existing.id }, data });
  else
    await prisma.hiringPosting.create({
      data: { requisitionId: l.req.id, channel: input.channel, ...data },
    });
  if (input.channel === "CAREERS_PAGE") revalidateTag(CAREERS_TAG, { expire: 0 });
}

export async function withdrawChannel(
  actor: HiringActor,
  l: LoadedRequisition,
  channel: HiringPostingChannel,
) {
  const existing = await prisma.hiringPosting.findUnique({
    where: { requisitionId_channel: { requisitionId: l.req.id, channel } },
    select: { id: true, state: true },
  });
  if (!existing || existing.state === "WITHDRAWN") {
    throw new HiringRuleError("This channel is not live, so there is nothing to withdraw.", 409);
  }
  await prisma.hiringPosting.update({
    where: { id: existing.id },
    data: { state: "WITHDRAWN", withdrawnAt: new Date(), withdrawnById: actor.userId },
  });
  if (channel === "CAREERS_PAGE") revalidateTag(CAREERS_TAG, { expire: 0 });
}
