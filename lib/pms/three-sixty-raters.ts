import { isThreeSixtyExempt } from "./three-sixty";

/**
 * §9.4 — who may be a rater, asked in one place.
 *
 * ## Why this is shared and not copied
 *
 * `POST /api/three-sixty/assignments` grew these checks inline, and the
 * per-assignment writer added for after-launch editing needs exactly the same
 * ones: a C-Level rater is excused 360 work entirely (§8.3), a leaver cannot be
 * given new work (§12.1), and nobody assesses themselves (§7.1 is where a
 * self-assessment lives). Two writers re-expressing one rule is the defect this
 * repo keeps producing — `YEAR_END_KPI_SELECT`, `countableParticipantWhere` and
 * `lib/pms/departure.ts` are all the same lesson — and it is worse here than
 * usual, because the divergence would not be a wrong number on a screen but a
 * person being asked to assess somebody they are not allowed to assess.
 *
 * The SELECT is shared for the same reason: a candidate read with fewer columns
 * than the rules need cannot be checked against them, and `templateTypeFor`
 * needs `managerId` to decide which of §9.2's three templates applies.
 */

/**
 * The columns every rater decision needs: `managerId` for §9.2's direction,
 * `roleTrack` for §8.3's exemption, `status` for §12.1, `departmentId` for
 * §9.4's same-department peer.
 */
export const THREE_SIXTY_CANDIDATE_SELECT = {
  id: true,
  managerId: true,
  roleTrack: true,
  departmentId: true,
  status: true,
} as const;

export type ThreeSixtyCandidate = {
  id: string;
  managerId: string | null;
  roleTrack: Parameters<typeof isThreeSixtyExempt>[0];
  departmentId: string | null;
  status: string;
};

/**
 * Why these people may not rate this employee, or null.
 *
 * Takes the whole proposed set rather than one person so the message can name a
 * count: HR setting three raters at once wants to know that one of them is a
 * leaver, not to discover it three saves later.
 */
export function raterEligibilityRefusal(params: {
  raters: ThreeSixtyCandidate[];
  rateeId: string;
}): { reason: string; status: 400 | 409 } | null {
  const { raters, rateeId } = params;

  if (raters.some((r) => r.id === rateeId)) {
    return {
      reason: "Nobody assesses themselves — §7.1 is where a self-assessment lives.",
      status: 400,
    };
  }

  const exempt = raters.filter((r) => isThreeSixtyExempt(r.roleTrack));
  if (exempt.length > 0) {
    return {
      reason: `C-Level are excused from 360 work entirely — ${exempt.length} named.`,
      status: 409,
    };
  }

  const leavers = raters.filter((r) => r.status !== "ACTIVE");
  if (leavers.length > 0) {
    return {
      reason: `${leavers.length} of those raters have left — choose someone else.`,
      status: 409,
    };
  }

  return null;
}
