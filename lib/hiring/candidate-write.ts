import type { HiringCandidate, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { can, seesComp, type HiringActor } from "./access";
import { referrerToPersist } from "./candidate-rules";
import { DETACHED_SUBJECT, type LoadedCandidate } from "./candidates";
import { newHiringId, sealAmount, sealNec } from "./comp-crypto";
import { occupiesSeat } from "./fill-rules";
import { HiringRuleError } from "./http";
import { isLiveUser } from "./people";
import { syncRequisitionFill } from "./requisition-status";
import { requisitionSubject } from "./scope";
import type { CandidateInput, CandidateUpdate } from "@/lib/validations/hiring/candidate";

/**
 * Candidate writes (Interview Hub `POST/PUT/DELETE /api/candidates`). The stage
 * is never written here — only the stage route moves a candidate. The NEC is
 * sealed under the ID-document key and the expectation under the hiring comp
 * key BEFORE the row is written, so neither reaches an audit row in clear.
 */

type Target = { requisitionId: string | null; subject: ScopeSubject; req: ReqComp | null };
type ReqComp = { hiringManagerId: string; hmSeesSalary: boolean };

/** Where a candidate is being placed, checked against the actor's manage scope. */
async function resolveTarget(actor: HiringActor, requisitionId: string | null): Promise<Target> {
  if (!requisitionId) {
    if (!can(actor, "hiring.manage", DETACHED_SUBJECT)) {
      throw new HiringRuleError("Choose a requisition for this candidate.", 400);
    }
    return { requisitionId: null, subject: DETACHED_SUBJECT, req: null };
  }
  const req = await prisma.hiringRequisition.findUnique({
    where: { id: requisitionId },
    select: { entityId: true, departmentId: true, hiringManagerId: true, hmSeesSalary: true },
  });
  const subject = req ? await requisitionSubject(req) : null;
  if (!req || !subject || !can(actor, "hiring.manage", subject)) {
    throw new HiringRuleError("That requisition was not found.", 404);
  }
  return { requisitionId, subject, req };
}

async function assertReferrer(id: string | null) {
  if (id && !(await isLiveUser(id))) {
    throw new HiringRuleError("The referrer no longer has an account.", 400);
  }
}

function compAllowed(actor: HiringActor, t: Target) {
  return seesComp(actor, t.subject, {
    hiringManagerId: t.req?.hiringManagerId,
    hmSeesSalary: t.req?.hmSeesSalary,
  });
}

export async function createCandidate(actor: HiringActor, data: CandidateInput) {
  const target = await resolveTarget(actor, data.requisitionId ?? null);
  const referredById = referrerToPersist(data.source, data.referredById);
  await assertReferrer(referredById);
  const id = newHiringId();
  const expectation = compAllowed(actor, target) ? data.salaryExpectation : null;
  return prisma.hiringCandidate.create({
    data: {
      id,
      requisitionId: target.requisitionId,
      name: data.name,
      email: data.email,
      phone: data.phone,
      nationality: data.nationality,
      currentEmployer: data.currentEmployer,
      linkedinUrl: data.linkedinUrl,
      deiGender: data.gender ?? null,
      necEnc: sealNec(id, data.nec),
      salaryExpectationEnc: sealAmount("candidate", id, "salaryExpectation", expectation),
      source: data.source,
      sourceAttribution: data.sourceAttribution,
      referredById,
      stage: "NEW_APPLICATION",
      ...(data.profileData ? { profileData: data.profileData as Prisma.InputJsonValue } : {}),
    },
    select: { id: true },
  });
}

/** The plain fields of an update (anything not supplied stays as it is). */
function plainChanges(data: CandidateUpdate): Prisma.HiringCandidateUncheckedUpdateInput {
  const out: Prisma.HiringCandidateUncheckedUpdateInput = {};
  const keys = [
    "name",
    "email",
    "phone",
    "nationality",
    "currentEmployer",
    "linkedinUrl",
    "source",
    "sourceAttribution",
  ] as const;
  for (const k of keys) if (data[k] !== undefined) (out as Record<string, unknown>)[k] = data[k];
  return out;
}

export async function updateCandidate(
  actor: HiringActor,
  l: LoadedCandidate,
  data: CandidateUpdate,
) {
  const c = l.cand;
  const moving =
    data.requisitionId !== undefined && (data.requisitionId ?? null) !== c.requisitionId;
  const target = moving
    ? await resolveTarget(actor, data.requisitionId ?? null)
    : { requisitionId: c.requisitionId, subject: l.subject, req: c.requisition };
  const changes = plainChanges(data);
  if (moving) changes.requisitionId = target.requisitionId;
  if (data.source !== undefined || data.referredById !== undefined) {
    const referredById = referrerToPersist(
      data.source ?? c.source,
      data.referredById !== undefined ? data.referredById : c.referredById,
    );
    await assertReferrer(referredById);
    changes.referredById = referredById;
  }
  // Restricted fields only change for readers who can see them — never blind overwrites.
  if (data.nec !== undefined && can(actor, "hiring.viewPii", l.subject)) {
    changes.necEnc = sealNec(c.id, data.nec);
  }
  if (data.gender !== undefined && can(actor, "hiring.viewDei", l.subject)) {
    changes.deiGender = data.gender;
  }
  if (data.salaryExpectation !== undefined && compAllowed(actor, target)) {
    changes.salaryExpectationEnc = sealAmount(
      "candidate",
      c.id,
      "salaryExpectation",
      data.salaryExpectation,
    );
  }
  await prisma.hiringCandidate.update({ where: { id: c.id }, data: changes, select: { id: true } });
  if (moving && occupiesSeat(c.stage)) {
    await syncRequisitionFill(c.requisitionId, { actorId: actor.userId, seatReleased: true });
    await syncRequisitionFill(target.requisitionId, { actorId: actor.userId });
  }
}

export async function deleteCandidate(actor: HiringActor, c: HiringCandidate) {
  await prisma.hiringCandidate.delete({ where: { id: c.id } });
  if (occupiesSeat(c.stage)) {
    await syncRequisitionFill(c.requisitionId, { actorId: actor.userId, seatReleased: true });
  }
}
