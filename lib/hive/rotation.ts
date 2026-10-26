import { fold, type CivilDate } from "./civil";

/**
 * §4.4's office rotation — "calculated, not manually maintained".
 *
 * The spec is emphatic: "It must be computed live from today's real date — never
 * hardcoded to a specific week, and never dependent on someone manually updating
 * a schedule." So this file holds no schedule. It holds an anchor and a parity
 * rule, and every answer falls out of those two.
 *
 * **Why this is the one HIVE answer worth a TDD suite.** A wrong leave figure
 * reads oddly and someone checks. A wrong rotation week reads perfectly and
 * sends a person to an empty office, or keeps them home on a day their whole
 * directorate is in. Nothing about the answer looks wrong. That is why §4.4's
 * table is transcribed here as code a reviewer can check line by line, and why
 * `tests/contracts/hive-rotation.test.ts` exists.
 *
 * No Prisma, no `server-only`: this is arithmetic, and keeping it importable
 * from anywhere is what makes it cheap to test. The DATA it is applied to —
 * which directorate is in which group — is admin-editable and lives in
 * `lib/hive/tools/rotation.ts`, per §4.4's closing note that "group/directorate
 * assignments and the constant/rotating structure itself must be admin-editable".
 *
 * @public
 */

/** §4.4's anchor, transcribed. 29 March 2026 is a Sunday (asserted in the tests
 *  rather than assumed) and §4.4 names it the start of a Type A week. */
export const ANCHOR: { date: string; type: "A" | "B" } = { date: "2026-03-29", type: "A" };

export type WeekType = "A" | "B";

/** §4.4's three structures. `CONSTANT` is Operations, which never rotates. */
export type RotationMode = "CONSTANT" | "GROUP_1" | "GROUP_2";

type PresenceStatus = "office" | "remote" | "weekend";

export interface Presence {
  status: PresenceStatus;
  /** Carried even on the weekend: "is next week A or B" is a real question. */
  weekType: WeekType;
  /** ISO day number, Mon=1 … Sun=7. */
  isoDay: number;
}

/** Midnight UTC on a civil date — a stable point for whole-day arithmetic. */
function utcMidnight(date: CivilDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

const DAY_MS = 86_400_000;

/**
 * ISO day number for a civil date: Mon=1 … Sun=7.
 *
 * ISO rather than JS's Sun=0, because §4.4 states the weekend as Friday and
 * Saturday and the schema stores `weekendDays` as ISO numbers `[5, 6]`. Two
 * numbering schemes for one concept is how an off-by-one gets in.
 */
function isoDayOf(date: CivilDate): number {
  const js = new Date(utcMidnight(date)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * The Sunday that starts this date's week.
 *
 * Sunday, because the Omani working week is Sun–Thu — so Friday and Saturday
 * belong to the week that just ENDED, not the one about to start. Getting this
 * backwards would answer every "what about this weekend" question for the wrong
 * week, and would look right five days out of seven.
 */
function weekStart(date: CivilDate): CivilDate {
  const iso = isoDayOf(date);
  const daysSinceSunday = iso % 7; // Sun(7) → 0, Mon(1) → 1, … Sat(6) → 6
  return new Date(utcMidnight(date) - daysSinceSunday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole weeks from one Sunday to another. Negative when `to` is earlier.
 *
 * Both operands are midnight UTC on a civil date, so this is exact integer
 * arithmetic — no DST hour to lose, because there is no DST in the civil dates
 * and none in Muscat either.
 */
export function weeksBetweenSundays(from: CivilDate, to: CivilDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / (7 * DAY_MS));
}

/**
 * Type A or Type B for the week containing `date`.
 *
 * The modulo is written `((n % 2) + 2) % 2` rather than `n % 2` because
 * JavaScript's `%` keeps the sign of the dividend: `-1 % 2` is `-1`, not `1`.
 *
 * **Honest note about that.** For THIS calculation the sign does not currently
 * matter: the cycle is 2 and the test is `=== 0`, so `-1` and `1` take the same
 * branch and `-0 === 0` is true. An earlier draft of this comment claimed the
 * naive form "gets every date before the anchor wrong"; mutation-testing the
 * suite disproved it — swapping in `weeks % 2` changed no behaviour and failed
 * no test. The claim was wrong, not the test.
 *
 * The normalised form stays, for a smaller and true reason: it is correct for
 * any cycle length and any parity test, so a future §4.4 amendment (a 3-week
 * cycle, or a `=== 1` branch) cannot reintroduce a sign bug here. What it is
 * NOT is the thing that makes pre-anchor dates work — the tests for those pass
 * either way, and they are worth keeping for the arithmetic they do cover.
 */
export function weekTypeFor(date: CivilDate, anchor = ANCHOR): WeekType {
  const weeks = weeksBetweenSundays(weekStart(anchor.date), weekStart(date));
  const parity = ((weeks % 2) + 2) % 2;
  if (anchor.type === "A") return parity === 0 ? "A" : "B";
  return parity === 0 ? "B" : "A";
}

/**
 * §4.4's table, transcribed:
 *
 * | Type A | Group 1 in-office Sun/Mon, remote Tue–Thu. Group 2 the reverse. |
 * | Type B | Reversed.                                                       |
 *
 * Sun/Mon are ISO 7 and 1; Tue–Thu are 2, 3 and 4.
 */
const EARLY_WEEK = new Set([7, 1]);

/**
 * Where a rotation group is on a given date.
 *
 * `weekendDays` is a parameter rather than a constant because the schema stores
 * it (`RotationConfig.weekendDays`) — §4.4's closing note requires the structure
 * itself to be admin-editable, and a hardcoded Fri/Sat would quietly outrank
 * whatever an admin set.
 */
export function presenceFor(
  mode: RotationMode,
  date: CivilDate,
  options: { anchor?: typeof ANCHOR; weekendDays?: number[] } = {},
): Presence {
  const anchor = options.anchor ?? ANCHOR;
  const weekendDays = options.weekendDays ?? [5, 6];
  const isoDay = isoDayOf(date);
  const weekType = weekTypeFor(date, anchor);

  // "Friday & Saturday — no rotation applies to ANYONE." Checked before the
  // constant, because Operations is in-office "every working day (Sun–Thu)" —
  // the constant is constant across WEEKS, not across the weekend.
  if (weekendDays.includes(isoDay)) return { status: "weekend", weekType, isoDay };

  if (mode === "CONSTANT") return { status: "office", weekType, isoDay };

  const early = EARLY_WEEK.has(isoDay);
  // In a Type A week Group 1 has the early half; in a Type B week Group 2 does.
  const groupHasEarlyHalf = weekType === "A" ? mode === "GROUP_1" : mode === "GROUP_2";
  return { status: early === groupHasEarlyHalf ? "office" : "remote", weekType, isoDay };
}

/**
 * A rotation group's coverage of one team, as the matcher needs it.
 *
 * Shaped here rather than in the tool because the MATCHING is pure — §4.1's
 * sub-team phrasings are string data, and keeping the matcher out from behind
 * `server-only` is what makes it directly testable.
 *
 * @public
 */
export interface CoverageRow {
  label: string;
  aliases: string[];
  mode: RotationMode;
  orgUnitId: string | null;
  /** HR Centre: the company this row belongs to (a company nothing covers is outside). */
  entityId?: string | null;
}

/**
 * Resolve what someone called their team to a rotation group.
 *
 * Exact match on the folded label or any alias — never a substring or a
 * similarity score. §4.4's structures overlap by design ("Data Engineering &
 * Analytics is a rotation Group 1 member, its own org directorate, and
 * separately covered by the Shahed/Afra HR pair"), and a fuzzy match across
 * overlapping vocabularies is how one structure silently starts answering for
 * another. If a phrasing does not resolve, the honest answer is to say so and
 * let the model ask — §4.1's fix for a missing phrasing is Alaa adding it as an
 * alias, not the code guessing harder.
 */
export function matchCoverage(coverage: CoverageRow[], said: string): CoverageRow | null {
  const needle = fold(said);
  if (!needle) return null;
  for (const row of coverage) {
    if (fold(row.label) === needle) return row;
    if (row.aliases.some((a) => fold(a) === needle)) return row;
  }
  return null;
}
