import { LINEAR_STAGES, TERMINAL_STAGES, stageRank, type Stage } from "./stage-rules";

/**
 * Mandatory-step gates — Interview Hub `lib/stage-gates.ts`. A forward move
 * that jumps a mandatory step the candidate never visited needs an HR Manager,
 * an explicit confirmation and a recorded reason; drafting an offer needs the
 * package evidenced (confirmed, or an attributed decline).
 */

/** The mandatory steps of the hiring process (steps 5, 7, 8 and 10). */
const GATE_STAGES: readonly Stage[] = [
  "CV_SCREENED",
  "FIRST_INTERVIEW",
  "DECISION_PENDING",
  "OFFER_DRAFTED",
];
const GATE_SET: ReadonlySet<Stage> = new Set(GATE_STAGES);

const GATE_REASON: Record<string, string> = {
  CV_SCREENED: "CV screening (step 5)",
  FIRST_INTERVIEW: "the first interview (step 7)",
  DECISION_PENDING: "the decision to select a preferred candidate (step 8)",
  OFFER_DRAFTED: "drafting the offer (step 10)",
};

const PACKAGE_GATE_REASON =
  "package confirmation (step 9) — record the pay-slip evidence, or record that the candidate declined to share it";

export const GATE_CODE = {
  confirmRequired: "GATE_CONFIRM_REQUIRED",
  reasonRequired: "GATE_REASON_REQUIRED",
  forbidden: "GATE_FORBIDDEN",
} as const;

/** The highest linear stage a reopened candidate had reached (resume point). */
function resumeRank(visited: ReadonlySet<Stage>): number {
  let best = -1;
  for (const stage of visited) {
    if (TERMINAL_STAGES.has(stage)) continue;
    best = Math.max(best, stageRank(stage));
  }
  return best >= 0 ? best : 0;
}

/** Mandatory stages a forward move jumps over that the candidate never visited. */
export function skippedGates(from: Stage, to: Stage, visited: Iterable<Stage>): Stage[] {
  if (TERMINAL_STAGES.has(to)) return [];
  const toRank = stageRank(to);
  const seen = new Set<Stage>(visited);
  const fromRank = TERMINAL_STAGES.has(from) ? resumeRank(seen) : stageRank(from);
  if (toRank <= fromRank) return [];
  return LINEAR_STAGES.filter(
    (s) => GATE_SET.has(s) && stageRank(s) > fromRank && stageRank(s) < toRank && !seen.has(s),
  );
}

/** Cheap pre-check: could this move skip a gate (so history must be read)? */
export function mayCrossGates(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.has(to)) return false;
  if (TERMINAL_STAGES.has(from)) return true;
  return skippedGates(from, to, []).length > 0;
}

function joinReasons(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function describeGates(gates: readonly Stage[]): string {
  return joinReasons(gates.map((g) => GATE_REASON[g] ?? g));
}

export type PackageEvidence = {
  packageConfirmedAt: Date | string | null;
  packageDeclinedAt: Date | string | null;
};

/** Drafting an offer needs the package confirmed OR an attributed decline. */
export function packageGateBlocks(to: Stage, evidence: PackageEvidence): boolean {
  if (to !== "OFFER_DRAFTED") return false;
  return evidence.packageConfirmedAt == null && evidence.packageDeclinedAt == null;
}

export type GateVerdict =
  | { ok: true; historyReason: string | null }
  | { ok: false; status: 422; code: string; message: string };

/**
 * The stage route's whole gate decision (Interview Hub order): forbidden for
 * non-overriders, then confirm, then a reason; the history line records what
 * was skipped.
 */
export function gateVerdict(input: {
  gaps: readonly Stage[];
  packageBlocked: boolean;
  mayOverride: boolean;
  overrideGates?: boolean;
  reason?: string | null;
}): GateVerdict {
  const { gaps, packageBlocked } = input;
  const reason = input.reason?.trim() || null;
  if (gaps.length === 0 && !packageBlocked) return { ok: true, historyReason: reason };
  const missing = joinReasons([
    ...gaps.map((g) => GATE_REASON[g] ?? g),
    ...(packageBlocked ? [PACKAGE_GATE_REASON] : []),
  ]);
  if (!input.mayOverride) {
    return {
      ok: false,
      status: 422,
      code: GATE_CODE.forbidden,
      message: `This move skips ${missing}. Only an HR Manager can authorise skipping a step.`,
    };
  }
  if (!input.overrideGates) {
    return {
      ok: false,
      status: 422,
      code: GATE_CODE.confirmRequired,
      message: `This move skips ${missing}. Confirm the exception to continue.`,
    };
  }
  if (!reason) {
    return {
      ok: false,
      status: 422,
      code: GATE_CODE.reasonRequired,
      message: `Skipping ${missing} needs a recorded reason.`,
    };
  }
  const skipped = [
    gaps.length ? describeGates(gaps) : null,
    packageBlocked ? PACKAGE_GATE_REASON : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return { ok: true, historyReason: `[Skipped ${skipped}] ${reason}` };
}
