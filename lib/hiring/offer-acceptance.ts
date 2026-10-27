import { auditedTransaction, prisma } from "@/lib/prisma";
import { signedReadUrl, putPrivateFile } from "@/lib/storage";
import type { HiringActor } from "./access";
import { applyStageChange } from "./candidate-stage";
import { readChecked, requireStorage } from "./candidate-files";
import { HiringRuleError } from "./http";
import { sameMuscatDay } from "./offer-rules";
import type { LoadedOffer } from "./offers";
import { stageRank } from "./stage-rules";

/**
 * Acceptance (step 12) — Interview Hub `/api/offers/[id]/acceptance`. The
 * joining date must be the offered start date (a different one is a revised
 * offer). D4: the candidate moves to OFFER_ACCEPTED, not straight to
 * pre-onboarding, so the acceptance side effects run — held rejection notices
 * on the requisition are released and the seat is counted.
 */

export const signedLetterPathname = (offerId: string) => `hiring/offers/${offerId}/signed.pdf`;

export async function recordAcceptance(
  actor: HiringActor,
  l: LoadedOffer,
  body: {
    joiningDate: Date;
    noticeDetail?: string | null;
    countersignedBy?: string | null;
    countersignedAt?: Date | null;
  },
) {
  const o = l.offer;
  if (o.status !== "SENT")
    throw new HiringRuleError("Only an offer that has been sent can be accepted.", 409);
  if (!sameMuscatDay(body.joiningDate, o.startDate)) {
    throw new HiringRuleError(
      "The joining date differs from the offered start date. Send a revised offer with the new start date first, then record the acceptance.",
      409,
      "JOINING_DATE_MISMATCH",
    );
  }
  const cand = await prisma.hiringCandidate.findUnique({
    where: { id: o.candidateId },
    select: { id: true, stage: true, requisitionId: true, preferredAt: true },
  });
  if (!cand) throw new HiringRuleError("The candidate on this offer no longer exists.", 404);
  if (cand.stage === "REJECTED" || cand.stage === "WITHDRAWN") {
    throw new HiringRuleError(
      "The candidate has left the process. Reopen them before recording an acceptance.",
      409,
    );
  }
  await auditedTransaction(async (tx) => {
    await tx.hiringOffer.update({
      where: { id: o.id, status: "SENT" },
      data: {
        status: "ACCEPTED",
        joiningDate: body.joiningDate,
        noticeDetail: body.noticeDetail ?? null,
        countersignedBy: body.countersignedBy ?? null,
        countersignedAt: body.countersignedBy ? (body.countersignedAt ?? new Date()) : null,
      },
      select: { id: true },
    });
  });
  let stageMoved = false;
  if (stageRank(cand.stage) < stageRank("OFFER_ACCEPTED")) {
    await applyStageChange({
      cand,
      toStage: "OFFER_ACCEPTED",
      movedById: actor.userId,
      reason: "Offer accepted — signed offer recorded.",
    });
    stageMoved = true;
  }
  return { status: "ACCEPTED" as const, stageMoved };
}

/** The signed letter (private blob). Any time after the offer is sent. */
export async function uploadSignedLetter(l: LoadedOffer, file: File) {
  if (!["SENT", "ACCEPTED"].includes(l.offer.status)) {
    throw new HiringRuleError("The signed letter can be added once the offer has been sent.", 409);
  }
  requireStorage();
  const { buffer } = await readChecked(file, ["application/pdf"]);
  const pathname = signedLetterPathname(l.offer.id);
  await putPrivateFile(pathname, buffer, "application/pdf", { overwrite: true });
  await prisma.hiringOffer.update({
    where: { id: l.offer.id },
    data: {
      signedBlobPathname: pathname,
      signedFileName: file.name.slice(0, 255),
      signedSizeBytes: buffer.length,
      signedAt: new Date(),
    },
    select: { id: true },
  });
  return { signedFileName: file.name.slice(0, 255), signedSizeBytes: buffer.length };
}

export async function signedLetterUrl(l: LoadedOffer) {
  if (!l.offer.signedBlobPathname) return null;
  requireStorage();
  return signedReadUrl(l.offer.signedBlobPathname);
}
