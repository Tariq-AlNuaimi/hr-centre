import { addWorkingDays, zonedToday, type WorkingCalendar } from "@/lib/working-time/calendar";
import { TERMINAL_STAGES, isPastFirstInterview, stageRank, type Stage } from "./stage-rules";

/**
 * Rejection-notice holds — Interview Hub `lib/services/rejection-notices.ts`.
 *
 * A finalist rejected while the preferred candidate's offer is still open is
 * held for five working days (they may be needed if the offer falls through);
 * everyone else is ready for a notice at once. Interview Hub hard-coded a
 * Fri+Sat weekend in Asia/Muscat; here the walk uses HR Centre's ONE working
 * calendar (ADR-077: the same default, plus public holidays).
 */

const HOLD_WORKING_DAYS = 5;

/**
 * Five working days from `heldFrom`, keeping the time of day: the local date
 * is walked on the calendar, and the instant moves by the same whole days.
 */
export function computeHoldExpiry(heldFrom: Date, calendar: WorkingCalendar): Date {
  const today = zonedToday(heldFrom, calendar.schedule.timeZone);
  const target = addWorkingDays(today, HOLD_WORKING_DAYS, calendar);
  return new Date(heldFrom.getTime() + (target.getTime() - today.getTime()));
}

export type NoticeStatus = "sent" | "held" | "ready";

const toDate = (v: Date | string | null | undefined): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v);

export function noticeState(input: {
  noticeSentAt?: Date | string | null;
  holdUntil?: Date | string | null;
  now?: Date;
}): { status: NoticeStatus; holdUntil: Date | null; expired: boolean } {
  const now = input.now ?? new Date();
  if (toDate(input.noticeSentAt)) return { status: "sent", holdUntil: null, expired: false };
  const holdUntil = toDate(input.holdUntil);
  if (holdUntil && holdUntil.getTime() > now.getTime()) {
    return { status: "held", holdUntil, expired: false };
  }
  return { status: "ready", holdUntil: null, expired: holdUntil !== null };
}

export type NoticeTemplate = "interviewed" | "screening";

export function noticeTemplateFor(reached: Stage): NoticeTemplate {
  return isPastFirstInterview(reached) ? "interviewed" : "screening";
}

export type StageMove = { fromStage: string; toStage: string };

/** The furthest linear stage a candidate reached (current stage + history). */
export function furthestStageReached(current: Stage, history: readonly StageMove[] = []): Stage {
  let best: Stage = TERMINAL_STAGES.has(current) ? "NEW_APPLICATION" : current;
  for (const move of history) {
    for (const stage of [move.fromStage, move.toStage] as Stage[]) {
      if (stageRank(stage) > stageRank(best)) best = stage;
    }
  }
  return best;
}

export function shouldHoldNotice(input: {
  reached: Stage;
  preferredCandidatePending: boolean;
}): boolean {
  return input.preferredCandidatePending && isPastFirstInterview(input.reached);
}
