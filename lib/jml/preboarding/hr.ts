import { env } from "@/lib/env";
import { isEmailEnabled } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { isStorageConfigured, signedReadUrl } from "@/lib/storage";
import { issueMagicLink, magicLinkUrl, revokeMagicLinks } from "@/lib/core/tokens/magic-link";
import { loadCaseFor } from "../access";
import type { JmlActor } from "../access";
import { JmlError } from "../errors";
import { PREBOARDING_PURPOSE, linkExpiry, preboardingBlockedReason, readDocuments } from "./rules";
import { savePreboarding, sendPreboardingEmail } from "./store";

/**
 * P2-4 — joiner preboarding (blueprint `docs/blueprints/p2-preboarding.md`).
 *
 * HR issues a magic link (ADR-090) for ONE joiner case; the joiner opens it
 * without an account and fills in an introduction, hobbies, a picture and a
 * documents checklist. Writing the form completes T09 (introduction/hobbies)
 * and, with a picture, T08 — the two starter tasks that only ever existed so HR
 * could copy what the joiner emailed. The documents answers are NOTED on T04–T07
 * and complete nothing: "I sent it" is not "HR received it".
 *
 * The token authorises exactly one case, and only while that case is an open
 * onboarding of someone who has not started (re-checked on every request).
 */

// --- HR side ---------------------------------------------------------------

/** The preboarding card on the joiner case. Needs view access to the case. */
export async function preboardingStatus(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "JOIN");
  const [row, detail, employee] = await Promise.all([
    prisma.jmlPreboarding.findUnique({ where: { caseId } }),
    prisma.jmlJoinDetail.findUnique({
      where: { caseId },
      select: { introSentence: true, hobbies: true, plannedStartDate: true },
    }),
    prisma.employee.findUnique({
      where: { id: kase.employeeId },
      select: { status: true, personalEmail: true },
    }),
  ]);
  const now = new Date();
  return {
    blockedReason: preboardingBlockedReason({
      caseType: kase.caseType,
      status: kase.status,
      employeeStatus: employee?.status ?? "",
    }),
    linkLive: Boolean(row?.linkExpiresAt && row.linkExpiresAt > now),
    linkIssuedAt: row?.linkIssuedAt ?? null,
    linkExpiresAt: row?.linkExpiresAt ?? null,
    submittedAt: row?.submittedAt ?? null,
    introSentence: detail?.introSentence ?? null,
    hobbies: detail?.hobbies ?? null,
    documents: readDocuments(row?.documents),
    photoUploadedAt: row?.photoUploadedAt ?? null,
    remindersSent: row?.remindersSent ?? 0,
    canEmail: isEmailEnabled() && Boolean(employee?.personalEmail),
    storageConfigured: isStorageConfigured(),
  };
}

async function loadIssuable(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageJoiners", "JOIN");
  const [employee, detail] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: kase.employeeId },
      select: {
        status: true,
        name: true,
        personalEmail: true,
        entity: { select: { name: true } },
      },
    }),
    prisma.jmlJoinDetail.findUnique({ where: { caseId }, select: { plannedStartDate: true } }),
  ]);
  const blocked = preboardingBlockedReason({
    caseType: kase.caseType,
    status: kase.status,
    employeeStatus: employee?.status ?? "",
  });
  if (blocked || !employee) throw new JmlError(blocked ?? "Joiner not found", 409);
  return { kase, employee, plannedStart: detail?.plannedStartDate ?? null };
}

/**
 * Issue a fresh link. Earlier links stay valid until they expire (the joiner
 * may be looking at the older email); revoke to cut them all. The raw link is
 * returned to HR once and never stored.
 */
export async function issuePreboardingLink(
  actor: JmlActor,
  caseId: string,
  opts: { email: boolean },
) {
  const { employee, plannedStart } = await loadIssuable(actor, caseId);
  const now = new Date();
  const expiresAt = linkExpiry(now, plannedStart);
  const raw = await issueMagicLink({
    purpose: PREBOARDING_PURPOSE,
    subjectId: caseId,
    ttlMs: expiresAt.getTime() - now.getTime(),
    createdById: actor.userId,
  });
  await savePreboarding(prisma, caseId, { linkIssuedAt: now, linkExpiresAt: expiresAt });
  // The origin is server-configured (AUTH_URL), never a request header. With no
  // configured origin the page builds the link from HR's own browser origin.
  const path = `/preboarding/${raw}`;
  const url = env.AUTH_URL ? magicLinkUrl(env.AUTH_URL, "preboarding", raw) : null;
  let emailed = false;
  if (opts.email && url && employee.personalEmail && isEmailEnabled()) {
    emailed = (await sendPreboardingEmail(employee, url, plannedStart)).sent;
  }
  return { path, url, expiresAt, emailed };
}

/** Cut every live link for this joiner. */
export async function revokePreboardingLinks(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.manageJoiners", "JOIN");
  const revoked = await revokeMagicLinks(PREBOARDING_PURPOSE, caseId);
  const existing = await prisma.jmlPreboarding.findUnique({
    where: { caseId },
    select: { caseId: true },
  });
  if (existing) {
    await prisma.jmlPreboarding.update({
      where: { caseId },
      data: { linkExpiresAt: null },
      select: { caseId: true },
    });
  }
  return { revoked };
}

/** A short-lived signed URL for the joiner's picture, for HR on the case. */
export async function preboardingPhotoUrl(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view", "JOIN");
  const row = await prisma.jmlPreboarding.findUnique({
    where: { caseId },
    select: { photoPathname: true },
  });
  if (!row?.photoPathname) throw new JmlError("No picture has been uploaded.", 404);
  if (!isStorageConfigured()) throw new JmlError("File storage is not configured.", 503);
  return { url: await signedReadUrl(row.photoPathname) };
}
