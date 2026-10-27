import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { isStorageConfigured, putPrivateFile } from "@/lib/storage";
import { PRIVACY_NOTICE_VERSION, type AgencySubmitInput } from "@/lib/validations/hiring/public";
import { alreadyApplied } from "./careers";
import { cvPathname, sniffType, MAX_FILE_BYTES } from "./candidate-files";
import { newHiringId, sealAmount } from "./comp-crypto";
import { HiringRuleError } from "./http";
import { orgNames } from "./people";
import { canPost } from "./posting-rules";

/**
 * Agency invites (step 4c) — Interview Hub `lib/services/agency-invites.ts`,
 * `/api/agency-invites`, `/agency/[token]`. The token is 256 random bits; only
 * its SHA-256 is stored and the raw link is shown once. Every failure of the
 * public link is the same "not valid" (no oracle). The submission cap holds
 * under concurrency: the create and the recount share a Serializable
 * transaction.
 */

const INVITE_TOKEN_BYTES = 32;
export const generateInviteToken = () => randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
export const hashInviteToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

export type InviteState = "valid" | "invalid" | "cap-reached";

/** Pure gate every public request runs through. */
export function evaluateInvite(
  invite: {
    expiresAt: Date;
    revokedAt: Date | null;
    maxSubmissions: number;
    requisitionId: string | null;
    requisition: { status: string; jdApprovedAt: Date | null } | null;
  } | null,
  submissions: number,
  now = new Date(),
): InviteState {
  if (!invite || invite.revokedAt || invite.expiresAt.getTime() <= now.getTime()) return "invalid";
  if (
    invite.requisitionId &&
    (!invite.requisition || !canPost(invite.requisition.status, invite.requisition.jdApprovedAt).ok)
  ) {
    return "invalid";
  }
  return submissions >= invite.maxSubmissions ? "cap-reached" : "valid";
}

export const INVITE_SELECT = {
  id: true,
  agencyName: true,
  requisitionId: true,
  entityId: true,
  expiresAt: true,
  revokedAt: true,
  maxSubmissions: true,
  requisition: {
    select: {
      id: true,
      title: true,
      status: true,
      jdApprovedAt: true,
      entityId: true,
      departmentId: true,
    },
  },
} as const;

/** Resolve a raw token. Details come back ONLY for a usable invite. */
async function resolveInvite(raw: string) {
  const invite = await prisma.hiringAgencyInvite.findUnique({
    where: { tokenHash: hashInviteToken(raw) },
    select: INVITE_SELECT,
  });
  if (!invite) return { state: "invalid" as const, invite: null };
  const submissions = await prisma.hiringCandidate.count({ where: { agencyInviteId: invite.id } });
  const state = evaluateInvite(invite, submissions);
  return state === "invalid" ? { state, invite: null } : { state, invite };
}

/** What the public page may show about a usable invite. */
export async function invitePageView(raw: string) {
  const r = await resolveInvite(raw);
  if (!r.invite) return { state: r.state };
  const req = r.invite.requisition;
  const org = await orgNames(
    [req?.entityId ?? r.invite.entityId].filter((v): v is string => Boolean(v)),
    req?.departmentId ? [req.departmentId] : [],
  );
  return {
    state: r.state,
    agencyName: r.invite.agencyName,
    role: req
      ? {
          title: req.title,
          department: req.departmentId ? (org.departments.get(req.departmentId) ?? null) : null,
        }
      : null,
    company: org.entities.get(req?.entityId ?? r.invite.entityId ?? "")?.name ?? null,
  };
}

class CapExceeded extends Error {}

/** The public submission. Returns whether the CV was stored (a CV failure does not lose the submission). */
export async function submitViaInvite(raw: string, input: AgencySubmitInput, file: File) {
  const r = await resolveInvite(raw);
  if (r.state === "invalid" || !r.invite)
    throw new HiringRuleError("This submission link is not valid.", 404);
  if (r.state === "cap-reached")
    throw new HiringRuleError(
      "This link has reached its submission limit. Contact your Rihal representative.",
      429,
    );
  if (!isStorageConfigured())
    throw new HiringRuleError(
      "Submissions are temporarily unavailable. Please try again later.",
      503,
      "STORAGE_NOT_CONFIGURED",
    );
  if (file.size === 0 || file.size > MAX_FILE_BYTES)
    throw new HiringRuleError("Attach the CV as a PDF of up to 10 MB.", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (sniffType(bytes) !== "application/pdf")
    throw new HiringRuleError("That file isn't a PDF. Please upload the CV as a PDF.", 400);
  const invite = r.invite;
  const email = input.candidateEmail.trim().toLowerCase();
  if (await alreadyApplied(email, invite.requisitionId)) {
    throw new HiringRuleError("This candidate has already been submitted for this role.", 409);
  }
  const id = newHiringId();
  try {
    await auditedTransaction(
      async (tx) => {
        await tx.hiringCandidate.create({
          data: {
            id,
            stage: "NEW_APPLICATION",
            source: "AGENCY",
            agencyName: invite.agencyName,
            agencyInviteId: invite.id,
            requisitionId: invite.requisitionId,
            consentAt: new Date(),
            noticeVersion: PRIVACY_NOTICE_VERSION,
            name: input.candidateName,
            email,
            currentEmployer: input.currentEmployer || null,
            salaryExpectationEnc: sealAmount(
              "candidate",
              id,
              "salaryExpectation",
              input.salaryExpectation,
            ),
            agencySubmissionNote: input.fitNote || null,
          },
          select: { id: true },
        });
        const total = await tx.hiringCandidate.count({ where: { agencyInviteId: invite.id } });
        if (total > invite.maxSubmissions) throw new CapExceeded();
        await tx.hiringAgencyInvite.update({
          where: { id: invite.id },
          data: { lastUsedAt: new Date() },
          select: { id: true },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e instanceof CapExceeded)
      throw new HiringRuleError(
        "This link has reached its submission limit. Contact your Rihal representative.",
        429,
      );
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new HiringRuleError("Another submission was in flight. Please try again.", 409);
    }
    throw e;
  }
  let cvStored = true;
  try {
    await putPrivateFile(cvPathname(id), bytes, "application/pdf", { overwrite: true });
    await prisma.hiringCandidate.update({
      where: { id },
      data: { cvBlobPathname: cvPathname(id), cvFileName: file.name.slice(0, 255) },
      select: { id: true },
    });
  } catch {
    cvStored = false;
  }
  return { submitted: true, cvStored };
}
