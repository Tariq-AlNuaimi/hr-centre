import { randomUUID } from "node:crypto";
import { notifyUsers } from "@/lib/notifications/user-notify";
import { formatDate } from "@/lib/format";
import { approvalRoleLabel, type RoutedStep } from "./approval-config";

/**
 * Hiring's bell notices (docs/blueprints/ux-p0.md, US-6). Hiring sends no email
 * (ADR-059), so before this an approver or panelist only learned of their turn
 * by browsing. Every sentence here is built from a title, a candidate's name, a
 * role and a date — never pay, never an ID number.
 */

/** A requisition / offer approval step is now waiting on its holders. */
export function notifyApprovalStep(params: {
  what: "requisition" | "offer";
  id: string;
  title: string;
  step: RoutedStep | undefined;
  round: string;
  exclude?: ReadonlyArray<string | null | undefined>;
}) {
  const { step } = params;
  if (!step) return Promise.resolve(0);
  const role = approvalRoleLabel(step.role);
  const body =
    params.what === "requisition"
      ? `The hiring request "${params.title}" is waiting for your approval (${role} step).`
      : `The offer for ${params.title} is waiting for your approval (${role} step).`;
  return notifyUsers(
    step.approvers.map((a) => a.id),
    {
      kind: "HIRING_APPROVAL_REQUESTED",
      module: "hiring",
      body,
      href:
        params.what === "requisition"
          ? `/hiring/requisitions/${params.id}/approval`
          : `/hiring/offers/${params.id}`,
      key: `hiring:${params.what}:${params.id}:${params.round}:${step.sequence}`,
    },
    params.exclude ?? [],
  );
}

/** A job description is up for sign-off: the hiring manager and the HR signers. */
export function notifyJdSubmitted(params: {
  requisitionId: string;
  title: string;
  version: number;
  recipients: Iterable<string>;
  submitterId: string;
}) {
  return notifyUsers(
    params.recipients,
    {
      kind: "HIRING_APPROVAL_REQUESTED",
      module: "hiring",
      body: `The job description for "${params.title}" is waiting for your sign-off.`,
      href: `/hiring/requisitions/${params.requisitionId}/jd`,
      key: `hiring:jd:${params.requisitionId}:v${params.version}`,
    },
    [params.submitterId],
  );
}

/** The person who submitted an offer hears how it was decided. */
export function notifyOfferDecided(params: {
  offerId: string;
  candidateName: string;
  submitterId: string | null;
  outcome: "APPROVED" | "REJECTED" | "SENT_BACK";
  deciderId: string;
}) {
  const said = {
    APPROVED: "was approved and can be sent",
    REJECTED: "was rejected",
    SENT_BACK: "was sent back to drafting",
  }[params.outcome];
  return notifyUsers(
    [params.submitterId],
    {
      kind: "HIRING_OFFER_DECIDED",
      module: "hiring",
      body: `The offer for ${params.candidateName} ${said}.`,
      href: `/hiring/offers/${params.offerId}`,
      key: `hiring:offer-decided:${params.offerId}:${randomUUID()}`,
    },
    [params.deciderId],
  );
}

/** A panelist owes a scorecard for this interview (one notice per interview). */
export function notifyScorecardDue(params: {
  interviewId: string;
  scheduledDate: Date | null;
  panelistIds: Iterable<string>;
}) {
  const when = params.scheduledDate ? ` on ${formatDate(params.scheduledDate)}` : "";
  return notifyUsers(params.panelistIds, {
    kind: "HIRING_SCORECARD_DUE",
    module: "hiring",
    body: `You're on an interview panel${when}. Score the candidate once the interview is done.`,
    href: `/hiring/panel/${params.interviewId}/score`,
    key: `hiring:scorecard:${params.interviewId}`,
  });
}
