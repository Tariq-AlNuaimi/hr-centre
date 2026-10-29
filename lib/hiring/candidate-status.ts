import { env } from "@/lib/env";
import { isEmailEnabled } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { sendLoggedEmail } from "@/lib/core/email/send";
import { issueMagicLink, magicLinkUrl, resolveMagicLink } from "@/lib/core/tokens/magic-link";
import { candidateFacingStage } from "./candidate-status-rules";

/**
 * P2-11 — the candidate status page (MyGreenhouse pattern): a magic link
 * (ADR-090, purpose `hiring-candidate-status`) that shows where an application
 * stands in CANDIDATE-FACING words. No internal stage name, no note, no score,
 * no interviewer, no reason leaves through it.
 *
 * Rejection is shown only once the human rejection notice has been sent
 * (`rejectionNoticeSentAt`): until then the page says "under review", so the
 * page never tells a candidate before HR does.
 */

export const CANDIDATE_STATUS_PURPOSE = "hiring-candidate-status";
const STATUS_TTL_MS = 180 * 86_400_000;

/** Mint the status link for a new application; returns the locale-less path. */
export async function issueCandidateStatusLink(candidateId: string): Promise<string> {
  const raw = await issueMagicLink({
    purpose: CANDIDATE_STATUS_PURPOSE,
    subjectId: candidateId,
    ttlMs: STATUS_TTL_MS,
  });
  return `/careers/status/${raw}`;
}

/** The application confirmation with the status link — only when SMTP and AUTH_URL exist. */
export async function emailApplicationReceived(params: {
  candidateId: string;
  name: string;
  email: string;
  roleTitle: string;
  statusPath: string;
}) {
  if (!isEmailEnabled() || !env.AUTH_URL) return { sent: false };
  const url = magicLinkUrl(env.AUTH_URL, "careers/status", params.statusPath.split("/").pop()!);
  const first = params.name.split(/\s+/)[0] ?? params.name;
  return sendLoggedEmail(
    {
      to: params.email,
      subject: `We received your application: ${params.roleTitle}`,
      text: [
        `Dear ${first},`,
        "",
        `Thank you for applying for ${params.roleTitle}. You can see where your application stands at any time here:`,
        url,
        "",
        "The link is personal to you; please do not forward it.",
      ].join("\n"),
    },
    {
      module: "hiring",
      type: "application-received",
      subjectType: "HiringCandidate",
      subjectId: params.candidateId,
    },
  );
}

/** Resolve a raw token to the page's view, or null (one failure for everything). */
export async function candidateStatusView(raw: string) {
  const link = await resolveMagicLink(CANDIDATE_STATUS_PURPOSE, raw);
  if (!link) return null;
  const c = await prisma.hiringCandidate.findFirst({
    where: { id: link.subjectId, erasedAt: null },
    select: {
      name: true,
      stage: true,
      rejectionNoticeSentAt: true,
      stallCauseStage: true,
      createdAt: true,
      requisitionId: true,
      stageHistory: { orderBy: { movedAt: "desc" }, take: 1, select: { movedAt: true } },
    },
  });
  if (!c) return null;
  const req = c.requisitionId
    ? await prisma.hiringRequisition.findUnique({
        where: { id: c.requisitionId },
        select: { title: true, entityId: true },
      })
    : null;
  const company = req
    ? await prisma.orgEntity.findUnique({ where: { id: req.entityId }, select: { name: true } })
    : null;
  const { step, outcome } = candidateFacingStage(c);
  // A rejection not yet notified must not move "last updated" either.
  const hideLastMove = c.stage === "REJECTED" && !c.rejectionNoticeSentAt;
  return {
    firstName: c.name.split(/\s+/)[0] ?? c.name,
    roleTitle: req?.title ?? null,
    companyName: company?.name ?? null,
    appliedOn: c.createdAt.toISOString().slice(0, 10),
    updatedOn: hideLastMove
      ? null
      : (c.stageHistory[0]?.movedAt.toISOString().slice(0, 10) ?? null),
    step,
    outcome,
  };
}
