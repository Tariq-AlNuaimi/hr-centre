import type { HiringPostingChannel } from "@/generated/prisma/client";

/**
 * Step 4 — posting & sourcing, pure (Interview Hub `lib/posting-channels.ts`).
 * Only CAREERS_PAGE is controlled by this app (it feeds the public board); the
 * other five are RECORDED: a person says they posted it there, and applicants
 * from that channel's sources are counted against it. The salary band is never
 * published (Restricted).
 */

export const POSTING_CHANNELS: HiringPostingChannel[] = [
  "CAREERS_PAGE",
  "LINKEDIN",
  "AGENCY",
  "REFERRAL",
  "TAWTEEN",
  "INTERNAL",
];

/** Candidate sources counted against each channel. */
const CHANNEL_SOURCES: Record<HiringPostingChannel, string[]> = {
  CAREERS_PAGE: ["CAREERS_PAGE"],
  LINKEDIN: ["LINKEDIN_PASTE"],
  AGENCY: ["AGENCY"],
  REFERRAL: ["REFERRAL"],
  TAWTEEN: ["TAWTEEN"],
  INTERNAL: ["INTERNAL"],
};

/** Channels that take a listing note in the post dialog. */
export const CHANNELS_WITH_DETAIL: HiringPostingChannel[] = ["LINKEDIN", "AGENCY", "TAWTEEN"];

/** A Tawteen listing is always Omani-preferred. */
export function omaniPreferredForced(channel: HiringPostingChannel): boolean {
  return channel === "TAWTEEN";
}

export type PostingGate = { ok: true } | { ok: false; reason: string };

/** Only an OPEN requisition whose JD is signed may be advertised (refusal copy per status). */
export function canPost(status: string, jdApprovedAt: Date | string | null): PostingGate {
  if (status === "OPEN") {
    return jdApprovedAt === null
      ? {
          ok: false,
          reason:
            "The job description isn't signed off yet — both signatories have to sign before the role can be advertised.",
        }
      : { ok: true };
  }
  const reasons: Record<string, string> = {
    DRAFT:
      "This requisition is still a draft — submit it for headcount approval before advertising it.",
    PENDING_APPROVAL:
      "Headcount and budget are still awaiting approval — an unapproved requisition cannot be advertised.",
    ON_HOLD: "This requisition is on hold. Reopen it before advertising the role.",
    REOPENED:
      "This requisition was reopened but is not open yet — move it to Open before advertising it.",
  };
  return {
    ok: false,
    reason:
      reasons[status] ??
      `A ${status.toLowerCase().replace(/_/g, " ")} requisition cannot be advertised.`,
  };
}

/** On the public board: OPEN ∧ JD signed ∧ a live careers posting. */
export function isAdvertisable(r: {
  status: string;
  jdApprovedAt: Date | string | null;
  hasLiveCareersPosting: boolean;
}): boolean {
  return r.status === "OPEN" && r.jdApprovedAt !== null && r.hasLiveCareersPosting;
}

/** Why a role is not on the board — the first fixable thing. Null when it is. */
export function notAdvertisedReason(r: {
  status: string;
  jdApprovedAt: Date | string | null;
  hasLiveCareersPosting: boolean;
}): "notOpen" | "jdUnsigned" | "notPosted" | null {
  if (isAdvertisable(r)) return null;
  if (r.status !== "OPEN") return "notOpen";
  if (r.jdApprovedAt === null) return "jdUnsigned";
  return "notPosted";
}

export type ChannelRow = {
  channel: HiringPostingChannel;
  live: boolean;
  detail: string | null;
  omaniPreferred: boolean;
  postedAt: string | null;
  postedByName: string | null;
  withdrawnAt: string | null;
  applicants: number;
};

/** One row per channel (posted or not) with its attributed applicant count. */
export function buildChannelRows(
  postings: ReadonlyArray<Omit<ChannelRow, "applicants">>,
  sourceCounts: Readonly<Record<string, number>>,
): ChannelRow[] {
  const byChannel = new Map(postings.map((p) => [p.channel, p]));
  return POSTING_CHANNELS.map((channel) => {
    const p = byChannel.get(channel);
    const applicants = CHANNEL_SOURCES[channel].reduce((n, s) => n + (sourceCounts[s] ?? 0), 0);
    return {
      channel,
      live: p?.live ?? false,
      detail: p?.detail ?? null,
      omaniPreferred: p?.omaniPreferred ?? false,
      postedAt: p?.postedAt ?? null,
      postedByName: p?.postedByName ?? null,
      withdrawnAt: p?.withdrawnAt ?? null,
      applicants,
    };
  });
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}
