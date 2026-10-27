/**
 * Re-key rules (Offboarding §26.1, build-plan 8.1), pure: a resignation that
 * happened before the case was keyed is entered with its real notice start,
 * and every task that fell due before today gets a disposition.
 */

const REKEY_MAX_BACKDATE_DAYS = 365;
const DAY = 86_400_000;
const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function rekeyEligibility(
  c: {
    noticeStartDate: Date;
    lastPhysicalWorkingDay: Date | null;
    lastDayOfService: Date | null;
    migrated: boolean;
  },
  now: Date,
): string[] {
  const out: string[] = [];
  if (c.migrated) out.push("A migrated historical record cannot be re-keyed.");
  const back = Math.round((day(now) - day(c.noticeStartDate)) / DAY);
  if (back <= 0)
    out.push("Re-key is for an exit whose notice started in the past — activate it normally.");
  if (back > REKEY_MAX_BACKDATE_DAYS)
    out.push(
      `The notice start is more than ${REKEY_MAX_BACKDATE_DAYS} days ago; import it as history instead.`,
    );
  if (!c.lastPhysicalWorkingDay || !c.lastDayOfService) out.push("Both exit dates are needed.");
  return out;
}

export type Disposition =
  | { code: string; outcome: "COMPLETED"; completedAt: Date }
  | { code: string; outcome: "NOT_APPLICABLE"; reason: string }
  | { code: string; outcome: "STILL_OUTSTANDING" };

/** The tasks due before today that need an answer — and what is wrong with the answers. */
export function dispositionProblems(
  dueBeforeToday: readonly string[],
  answers: readonly Disposition[],
  bounds: { noticeStartDate: Date; now: Date },
): string[] {
  const out: string[] = [];
  const expected = new Set(dueBeforeToday);
  const given = new Set<string>();
  for (const a of answers) {
    if (!expected.has(a.code)) out.push(`${a.code} is not a task due before today.`);
    if (given.has(a.code)) out.push(`${a.code} is answered twice.`);
    given.add(a.code);
    if (a.outcome === "COMPLETED") {
      if (day(a.completedAt) > day(bounds.now))
        out.push(`${a.code}: a completion date cannot be in the future.`);
      if (day(a.completedAt) < day(bounds.noticeStartDate))
        out.push(`${a.code}: completed before the notice started?`);
    }
  }
  const missing = dueBeforeToday.filter((c) => !given.has(c));
  if (missing.length) out.push(`Say what happened to: ${missing.join(", ")}.`);
  return out;
}

export function dueBeforeToday(
  tasks: readonly { code: string; dueDate: Date | null }[],
  now: Date,
): string[] {
  return tasks.filter((t) => t.dueDate && day(t.dueDate) < day(now)).map((t) => t.code);
}
