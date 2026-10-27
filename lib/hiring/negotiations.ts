import { prisma } from "@/lib/prisma";
import type { HiringActor } from "./access";
import { newHiringId, openAmount, sealAmount } from "./comp-crypto";
import { HiringRuleError } from "./http";

/**
 * Negotiation notes (Interview Hub `/api/{candidates,offers}/[id]/negotiations`):
 * pre-offer alignment on the candidate, negotiation on the offer. The whole
 * thread is pay talk, so it is hidden from anyone without comp access — the
 * caller passes `comp` from the record's own comp rule.
 */

const CAP = 200;

export type NoteBody = {
  body: string;
  discussedSalary?: number | null;
  discussedStartDate?: Date | null;
  candidateConfirmed?: boolean;
};

export async function thread(candidateId: string, offerId: string | null, comp: boolean) {
  if (!comp) return { notes: [], restricted: true };
  const rows = await prisma.hiringNegotiationNote.findMany({
    where: offerId
      ? { OR: [{ offerId }, { candidateId, kind: "PRE_OFFER_ALIGNMENT" }] }
      : { candidateId },
    orderBy: { createdAt: "asc" },
    take: CAP,
  });
  return {
    restricted: false,
    notes: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      body: n.body,
      authorName: n.authorName,
      discussedSalary: openAmount("negotiationNote", n.id, "discussedSalary", n.discussedSalaryEnc),
      discussedStartDate: n.discussedStartDate,
      candidateConfirmed: n.candidateConfirmed,
      createdAt: n.createdAt,
    })),
  };
}

export async function addNote(
  actor: HiringActor,
  target: { candidateId: string; offerId: string | null },
  comp: boolean,
  b: NoteBody,
) {
  if (!comp)
    throw new HiringRuleError(
      "Negotiation notes are pay discussions, so they need compensation access.",
      403,
    );
  const id = newHiringId();
  await prisma.hiringNegotiationNote.create({
    data: {
      id,
      candidateId: target.candidateId,
      offerId: target.offerId,
      kind: target.offerId ? "NEGOTIATION" : "PRE_OFFER_ALIGNMENT",
      body: b.body,
      authorId: actor.userId,
      authorName: actor.name,
      discussedSalaryEnc: sealAmount(
        "negotiationNote",
        id,
        "discussedSalary",
        b.discussedSalary ?? null,
      ),
      discussedStartDate: b.discussedStartDate ?? null,
      candidateConfirmed: b.candidateConfirmed ?? false,
    },
    select: { id: true },
  });
  return { id };
}
