import type { HiringNeedStatus } from "@/generated/prisma/client";

/**
 * Step 1 — workforce planning, pure (Interview Hub
 * `workforce-planning-rules.ts`, artboard W01). A department has RESPONDED when
 * it told HR a number, including zero; silence is `rolesRequested === null`.
 */

export const NEEDS_PER_ROUND_LIMIT = 100;
export const NOTES_PER_NEED_LIMIT = 50;

export type NeedFacts = {
  department: string;
  status: HiringNeedStatus;
  rolesRequested: number | null;
  agreedRoles: number | null;
  raised: boolean;
};

export type RoundStats = {
  departmentsAsked: number;
  responded: number;
  outstanding: number;
  rolesRequested: number;
  agreedAfterChallenge: number;
  stillToDiscuss: number;
  raisedDepartments: string[];
  readyToRaise: string[];
};

const hasResponded = (n: { rolesRequested: number | null }) =>
  n.rolesRequested !== null && n.rolesRequested !== undefined;

export function summarizeRound(needs: readonly NeedFacts[]): RoundStats {
  const s: RoundStats = {
    departmentsAsked: needs.length,
    responded: 0,
    outstanding: 0,
    rolesRequested: 0,
    agreedAfterChallenge: 0,
    stillToDiscuss: 0,
    raisedDepartments: [],
    readyToRaise: [],
  };
  for (const n of needs) {
    if (hasResponded(n)) {
      s.responded += 1;
      s.rolesRequested += n.rolesRequested ?? 0;
    }
    if (n.status === "CHALLENGE_AGREED") {
      s.agreedAfterChallenge += n.agreedRoles ?? n.rolesRequested ?? 0;
      (n.raised ? s.raisedDepartments : s.readyToRaise).push(n.department);
    }
    if (n.status === "SUBMITTED") s.stillToDiscuss += n.rolesRequested ?? 0;
  }
  s.outstanding = s.departmentsAsked - s.responded;
  return s;
}

/** "A requisition cannot be raised before that conversation" — enforced at the API. */
export function canRaiseRequisition(need: {
  status: HiringNeedStatus;
  agreedRoles: number | null;
  rolesRequested: number | null;
}): { ok: true } | { ok: false; reason: string } {
  if (need.status === "CHALLENGE_AGREED") {
    return (need.agreedRoles ?? need.rolesRequested ?? 0) < 1
      ? {
          ok: false,
          reason:
            "The challenge agreed zero roles for this department, so there is no headcount to raise.",
        }
      : { ok: true };
  }
  if (need.status === "NO_NEED") {
    return { ok: false, reason: "This department confirmed it has no need this cycle." };
  }
  if (need.status === "SUBMITTED") {
    return {
      ok: false,
      reason:
        "This requirement has not been challenged yet. Hold the discussion and record its outcome before raising a requisition.",
    };
  }
  return {
    ok: false,
    reason: "This department has not submitted a requirement, so there is nothing to raise.",
  };
}

/** Needs a "Chase non-responders" sweep touches: asked and never answered. */
export function chaseableNeedIds(
  needs: readonly { id: string; status: HiringNeedStatus; rolesRequested: number | null }[],
): string[] {
  return needs
    .filter((n) => !hasResponded(n) && (n.status === "ASKED" || n.status === "NO_RESPONSE"))
    .map((n) => n.id);
}

/** Which contact moment the "Last contact" column shows (the UI formats it). */
export function lastContact(n: {
  status: HiringNeedStatus;
  askedAt: Date | string | null;
  chasedAt: Date | string | null;
  submittedAt: Date | string | null;
  discussedAt: Date | string | null;
}): { kind: "discussed" | "submitted" | "chased" | "noResponse" | "asked"; at: string | null } {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const settled = n.status === "CHALLENGE_AGREED" || n.status === "NO_NEED";
  if (settled && n.discussedAt) return { kind: "discussed", at: iso(n.discussedAt) };
  if (n.status === "SUBMITTED" && n.submittedAt)
    return { kind: "submitted", at: iso(n.submittedAt) };
  if (n.status === "NO_RESPONSE") {
    return n.chasedAt
      ? { kind: "chased", at: iso(n.chasedAt) }
      : { kind: "noResponse", at: iso(n.askedAt) };
  }
  if (n.discussedAt) return { kind: "discussed", at: iso(n.discussedAt) };
  if (n.submittedAt) return { kind: "submitted", at: iso(n.submittedAt) };
  if (n.chasedAt) return { kind: "chased", at: iso(n.chasedAt) };
  return { kind: "asked", at: iso(n.askedAt) };
}

/** Timestamps a need status change stamps (W01). */
export function stampsFor(status: HiringNeedStatus, now: Date) {
  if (status === "SUBMITTED") return { submittedAt: now };
  if (status === "CHALLENGE_AGREED" || status === "NO_NEED") return { discussedAt: now };
  if (status === "NO_RESPONSE") return { chasedAt: now };
  return {};
}
