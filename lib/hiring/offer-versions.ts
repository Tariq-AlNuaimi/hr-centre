import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { computeChain, totalMonthlyComp } from "./approval-chain";
import {
  assertChainStaffed,
  configToChainOptions,
  loadApprovalConfig,
  routeChain,
} from "./approval-config";
import { newHiringId, openJson, sealAmount, sealJson } from "./comp-crypto";
import { HiringRuleError } from "./http";
import {
  diffOfferTerms,
  nextVersionNumber,
  restartsApproval,
  summarizeVersion,
  withSupersession,
  type OfferTerms,
} from "./offer-package";
import { offerPay, type LoadedOffer } from "./offers";

/**
 * Offer versions and revisions (Interview Hub `offer-versions.ts` +
 * `/api/offers/[id]/versions`). A version freezes the sent terms (sealed);
 * a revision of a SENT offer appends one, and moving the money sends the
 * offer back through a fresh approval chain.
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];
const WINDOW = 200;

export function termsOf(o: LoadedOffer["offer"]): OfferTerms {
  const pay = offerPay(o);
  return {
    salary: pay.salary,
    allowances: pay.allowances,
    startDate: o.startDate.toISOString(),
    probationMonths: o.probationMonths,
    noticePeriod: o.noticePeriod,
    contractType: o.contractType,
    benefits: o.benefits,
  };
}

async function createVersion(
  tx: Tx,
  offerId: string,
  data: {
    versionNumber: number;
    terms: OfferTerms;
    changed: string[];
    compChanged: boolean;
    restarted: boolean;
    note?: string | null;
  },
  actor: HiringActor,
) {
  const id = newHiringId();
  await tx.hiringOfferVersion.create({
    data: {
      id,
      offerId,
      versionNumber: data.versionNumber,
      termsSnapshotEnc: sealJson("offerVersion", id, "termsSnapshot", data.terms)!,
      summary: summarizeVersion(data.versionNumber, data.changed),
      changedFields: data.changed,
      compChanged: data.compChanged,
      restartedApproval: data.restarted,
      candidateNote: data.note ?? null,
      createdById: actor.userId,
      createdByName: actor.name,
    },
    select: { id: true },
  });
}

/** v1 = the terms as first sent. Idempotent: an offer with any version keeps its history. */
export async function ensureInitialVersion(tx: Tx, l: LoadedOffer, actor: HiringActor) {
  const any = await tx.hiringOfferVersion.findFirst({
    where: { offerId: l.offer.id },
    select: { id: true },
  });
  if (any) return;
  await createVersion(
    tx,
    l.offer.id,
    {
      versionNumber: 1,
      terms: termsOf(l.offer),
      changed: [],
      compChanged: false,
      restarted: false,
    },
    actor,
  );
}

/** The versions, oldest first; terms opened only for a comp reader. */
export async function listVersions(l: LoadedOffer) {
  const rows = await prisma.hiringOfferVersion.findMany({
    where: { offerId: l.offer.id },
    orderBy: { versionNumber: "asc" },
    take: WINDOW,
  });
  return withSupersession(rows).map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    summary: v.summary,
    changedFields: v.changedFields,
    compChanged: v.compChanged,
    restartedApproval: v.restartedApproval,
    candidateNote: v.candidateNote,
    createdByName: v.createdByName,
    createdAt: v.createdAt,
    current: v.current,
    terms: l.comp
      ? openJson<OfferTerms>("offerVersion", v.id, "termsSnapshot", v.termsSnapshotEnc)
      : null,
  }));
}

export type RevisionBody = {
  salary?: number | null;
  allowances?: Record<string, number> | null;
  startDate?: Date;
  probationMonths?: number;
  noticePeriod?: string | null;
  contractType?: string | null;
  candidateNote?: string;
};

/** Send a revised offer. Only a SENT offer; nothing changed → 400; pay changed → back to approval. */
export async function reviseOffer(actor: HiringActor, l: LoadedOffer, body: RevisionBody) {
  const o = l.offer;
  if (o.status !== "SENT")
    throw new HiringRuleError("Only an offer that has been sent can be revised.", 409);
  if (!l.comp && (body.salary !== undefined || body.allowances !== undefined)) {
    throw new HiringRuleError(
      "You don't have access to compensation, so you can't revise the pay.",
      403,
    );
  }
  const prev = termsOf(o);
  const patch: OfferTerms = {
    salary: body.salary,
    allowances: body.allowances,
    startDate: body.startDate?.toISOString(),
    probationMonths: body.probationMonths,
    noticePeriod: body.noticePeriod,
    contractType: body.contractType,
  };
  const changed = diffOfferTerms(prev, patch);
  if (changed.length === 0)
    throw new HiringRuleError("Nothing in the terms changed, so there is nothing to revise.", 400);
  const restart = restartsApproval(changed);
  const next: OfferTerms = { ...prev, ...Object.fromEntries(changed.map((f) => [f, patch[f]])) };
  const chain = restart
    ? computeChain(
        l.entity?.code,
        totalMonthlyComp(next.salary, next.allowances),
        configToChainOptions(await loadApprovalConfig()),
      )
    : null;
  // A revision that restarts approval must not land on a step nobody holds.
  if (chain) assertChainStaffed(await routeChain(chain, l.subject), [o.candidate.referredById]);
  await auditedTransaction(async (tx) => {
    await ensureInitialVersion(tx, l, actor);
    const existing = await tx.hiringOfferVersion.findMany({
      where: { offerId: o.id },
      select: { id: true, versionNumber: true },
      orderBy: { versionNumber: "desc" },
      take: WINDOW,
    });
    await createVersion(
      tx,
      o.id,
      {
        versionNumber: nextVersionNumber(existing),
        terms: next,
        changed,
        compChanged: restart,
        restarted: restart,
        note: body.candidateNote,
      },
      actor,
    );
    const now = new Date();
    for (const prior of existing)
      await tx.hiringOfferVersion.update({ where: { id: prior.id }, data: { supersededAt: now } });
    if (restart) {
      const old = await tx.hiringOfferApproval.findMany({
        where: { offerId: o.id },
        select: { id: true },
        take: 50,
      });
      for (const a of old) await tx.hiringOfferApproval.delete({ where: { id: a.id } });
    }
    await tx.hiringOffer.update({
      where: { id: o.id, status: "SENT" },
      data: {
        ...(changed.includes("salary")
          ? { salaryEnc: sealAmount("offer", o.id, "salary", next.salary) }
          : {}),
        ...(changed.includes("allowances")
          ? { allowancesEnc: sealJson("offer", o.id, "allowances", next.allowances) }
          : {}),
        ...(changed.includes("startDate") ? { startDate: new Date(next.startDate!) } : {}),
        ...(changed.includes("probationMonths")
          ? { probationMonths: next.probationMonths ?? 3 }
          : {}),
        ...(changed.includes("noticePeriod") ? { noticePeriod: next.noticePeriod } : {}),
        ...(changed.includes("contractType") ? { contractType: next.contractType } : {}),
        ...(restart
          ? {
              status: "PENDING_APPROVAL",
              submittedById: actor.userId,
              approvalChain: chain as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      select: { id: true },
    });
  });
  return { changedFields: changed, restartedApproval: restart };
}
