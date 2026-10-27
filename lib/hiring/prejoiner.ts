import type { ContractType } from "@/generated/prisma/client";
import { withdrawJoinCase, openJoinCase } from "@/lib/jml/join/open-join";
import { placeholderEmail, provisionalOdooId } from "@/lib/people/provisional-id";
import { employeeCreateData } from "@/lib/people/write";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { openAmount } from "./comp-crypto";

/**
 * Step 14 hand-off into JML (ADR-082 D8). At OFFER_ACCEPTED — whichever path
 * got the candidate there (the acceptance form or the stage rail) — Hiring
 * creates the PRE_JOINER core employee through THE writer
 * (`lib/people/write.ts`) and opens a draft JOIN case with `openJoinCase`;
 * HR completes and activates it in JML. Interview Hub's own onboarding
 * templates and tasks are not ported: JML is the onboarding system.
 *
 * Idempotent: the candidate keeps `employeeId`, and the join case is keyed by
 * `hiring:<candidateId>`. Best-effort from the acceptance path — a failure
 * never undoes the acceptance; it is reported, and the pre-boarding screen
 * offers to try again.
 */

export const sourceRefFor = (candidateId: string) => `hiring:${candidateId}`;

const CONTRACT_TYPES: readonly ContractType[] = [
  "PERMANENT",
  "FIXED_TERM",
  "INTERN",
  "PART_TIME",
  "SECONDMENT",
  "SUMMER_INTERN",
  "TRAINEE",
  "FREELANCER",
];

/** Offer free text ("Fixed term", "permanent") → the core enum, or null. */
export function toContractType(raw: string | null | undefined): ContractType | null {
  const k = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return (CONTRACT_TYPES as readonly string[]).includes(k) ? (k as ContractType) : null;
}

/** A date-only value as the UTC midnight of its Muscat calendar day (how JML stores days). */
export function muscatMidnight(d: Date): Date {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Muscat",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return new Date(`${day}T00:00:00Z`);
}

export type HandoffResult =
  | { ok: true; employeeId: string; caseId: string; created: boolean }
  | { ok: false; reason: string };

async function acceptedOffer(candidateId: string) {
  return prisma.hiringOffer.findFirst({
    where: { candidateId, status: "ACCEPTED" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      salaryEnc: true,
      startDate: true,
      joiningDate: true,
      contractType: true,
      probationMonths: true,
    },
  });
}

async function ensurePreJoiner(
  candidateId: string,
): Promise<{ employeeId: string } | { reason: string }> {
  const c = await prisma.hiringCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      nationality: true,
      employeeId: true,
      requisition: { select: { title: true, entityId: true, departmentId: true } },
    },
  });
  if (!c) return { reason: "The candidate no longer exists." };
  if (c.employeeId) return { employeeId: c.employeeId };
  if (!c.requisition)
    return {
      reason:
        "The candidate is not on a requisition, so there is no company or department to hire them into.",
    };
  const offer = await acceptedOffer(c.id);
  const salary = offer ? openAmount("offer", offer.id, "salary", offer.salaryEnc) : null;
  const start = offer ? muscatMidnight(offer.joiningDate ?? offer.startDate) : null;
  const odooId = provisionalOdooId();
  const req = c.requisition;
  const employeeId = await auditedTransaction(async (tx) => {
    const e = await tx.employee.create({
      data: employeeCreateData(
        {
          odooId,
          name: c.name,
          email: placeholderEmail(),
          departmentId: req.departmentId,
          teamId: null,
          entityId: req.entityId,
          roleTrack: "INDIVIDUAL",
          basicSalary: salary === null ? null : String(salary),
          status: "PRE_JOINER",
          dateOfJoining: start,
          lastWorkingDay: null,
          unpaidLeaveDays: 0,
        },
        {
          jobTitle: req.title,
          contractType: toContractType(offer?.contractType),
          personalEmail: c.email,
          personalPhone: c.phone,
          nationality: c.nationality,
        },
        { userId: null },
      ),
      select: { id: true },
    });
    // The candidate keeps the link; a concurrent acceptance loses this CAS and is rolled back.
    await tx.hiringCandidate.update({
      where: { id: c.id, employeeId: null },
      data: { employeeId: e.id },
      select: { id: true },
    });
    return e.id;
  });
  return { employeeId };
}

export async function handToJml(
  candidateId: string,
  actorUserId: string | null,
): Promise<HandoffResult> {
  try {
    const pre = await ensurePreJoiner(candidateId);
    if ("reason" in pre) return { ok: false, reason: pre.reason };
    const offer = await acceptedOffer(candidateId);
    const res = await openJoinCase(
      {
        employeeId: pre.employeeId,
        sourceRef: sourceRefFor(candidateId),
        plannedStartDate: offer ? muscatMidnight(offer.joiningDate ?? offer.startDate) : null,
        contractTypeId: null,
        probationMonths:
          offer && offer.probationMonths >= 0 && offer.probationMonths <= 36
            ? offer.probationMonths
            : null,
      },
      actorUserId,
    );
    return { ok: true, employeeId: pre.employeeId, caseId: res.caseId, created: res.created };
  } catch (e) {
    console.error("hiring hand-off to JML failed");
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "The hand-off to onboarding failed.",
    };
  }
}

/** The candidate left after accepting: the onboarding draft is discarded (or an active one cancelled). */
export async function withdrawFromJml(
  candidateId: string,
  actorUserId: string | null,
  reason: string,
) {
  try {
    return await withdrawJoinCase(sourceRefFor(candidateId), reason, actorUserId);
  } catch {
    console.error("hiring: withdrawing the JML join case failed");
    return { outcome: "none" as const };
  }
}
