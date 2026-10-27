/**
 * Interview rounds, briefs and schedule status — Interview Hub
 * `interview-brief.ts`, pure. A requisition's round plan is its configured
 * briefs in order, then any round already scheduled without a brief (so an
 * invite always has a length and an ordinal).
 */

export const CANONICAL_ROUND_ORDER = ["SCREENING", "TECHNICAL", "PANEL", "FINAL"] as const;
export const DEFAULT_ROUND_MINUTES = 60;

export type BriefInput = {
  round: string;
  roundOrder: number;
  competencies: string[];
  durationMinutes: number;
};

export type RoundPlanEntry = {
  round: string;
  ordinal: number;
  competencies: string[];
  durationMinutes: number;
  configured: boolean;
};

function canonicalIndex(round: string): number {
  const i = (CANONICAL_ROUND_ORDER as readonly string[]).indexOf(round);
  return i === -1 ? CANONICAL_ROUND_ORDER.length : i;
}

export function buildRoundPlan(
  briefs: readonly BriefInput[],
  scheduledRounds: readonly string[] = [],
): RoundPlanEntry[] {
  const seen = new Set<string>();
  const plan: RoundPlanEntry[] = [];
  const configured = [...briefs].sort(
    (a, b) => a.roundOrder - b.roundOrder || canonicalIndex(a.round) - canonicalIndex(b.round),
  );
  for (const b of configured) {
    if (seen.has(b.round)) continue;
    seen.add(b.round);
    plan.push({
      round: b.round,
      ordinal: plan.length + 1,
      competencies: b.competencies ?? [],
      durationMinutes: b.durationMinutes > 0 ? b.durationMinutes : DEFAULT_ROUND_MINUTES,
      configured: true,
    });
  }
  const inferred = [...new Set(scheduledRounds)]
    .filter((r) => !seen.has(r))
    .sort((a, b) => canonicalIndex(a) - canonicalIndex(b));
  for (const round of inferred) {
    plan.push({
      round,
      ordinal: plan.length + 1,
      competencies: [],
      durationMinutes: DEFAULT_ROUND_MINUTES,
      configured: false,
    });
  }
  return plan;
}

export function resolveBriefForRound(
  plan: readonly RoundPlanEntry[],
  round: string,
): RoundPlanEntry {
  return (
    plan.find((e) => e.round === round) ?? {
      round,
      ordinal: 0,
      competencies: [],
      durationMinutes: DEFAULT_ROUND_MINUTES,
      configured: false,
    }
  );
}

export function interviewEndsAt(start: Date, durationMinutes = DEFAULT_ROUND_MINUTES): Date {
  const minutes = durationMinutes > 0 ? durationMinutes : DEFAULT_ROUND_MINUTES;
  return new Date(start.getTime() + minutes * 60_000);
}

export type ScheduleStatusCode =
  "CANCELLED" | "COMPLETED" | "IN_PROGRESS" | "NO_PANEL" | "CONFIRMED" | "INVITES_SENT";

/** What a schedule row says about its panel's RSVPs (the UI words it). */
export function scheduleStatus(
  status: string,
  panel: readonly { confirmedAt: Date | string | null }[],
): { code: ScheduleStatusCode; confirmed: number; total: number } {
  const total = panel.length;
  const confirmed = panel.filter((p) => p.confirmedAt != null).length;
  if (status === "CANCELLED" || status === "COMPLETED" || status === "IN_PROGRESS") {
    return { code: status, confirmed, total };
  }
  if (total === 0) return { code: "NO_PANEL", confirmed, total };
  return { code: confirmed === total ? "CONFIRMED" : "INVITES_SENT", confirmed, total };
}

const ROUND_NAME: Record<string, string> = {
  SCREENING: "Screening",
  TECHNICAL: "Technical",
  PANEL: "Panel",
  FINAL: "Final",
};

/** "Round 2 · Technical" — used in calendar files, which are not localised UI. */
export function roundLabel(round: string, ordinal: number | null | undefined): string {
  const name = ROUND_NAME[round] ?? round;
  return ordinal && ordinal > 0 ? `Round ${ordinal} · ${name}` : name;
}

// ---------------------------------------------------------------- panel reveal

export type PanelAiMode = "blind" | "assisted" | "off";

export function asPanelAiMode(raw: unknown): PanelAiMode {
  return raw === "assisted" || raw === "off" ? raw : "blind";
}

/**
 * Anti-anchoring: in blind mode a panelist sees the AI view and their peers'
 * scorecards only after submitting their own; "assisted" shows them during
 * scoring; "off" never.
 */
export function canReveal(mode: PanelAiMode, ownSubmitted: boolean): boolean {
  if (mode === "off") return false;
  if (mode === "assisted") return true;
  return ownSubmitted;
}
