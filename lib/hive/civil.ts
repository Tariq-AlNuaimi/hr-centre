/**
 * Civil dates and text folding — the two pure things several HIVE tools need.
 *
 * These started inside `lib/hive/rotation.ts` because the rotation needed them
 * first, and they were moved the moment the discount expiry needed them too:
 * neither is a rotation concept, and a module whose name stops describing its
 * contents is how the next person fails to find what is already here.
 *
 * Nothing in this file touches Prisma, Next or `server-only`, which is what
 * makes it directly testable — and testable is the whole point, because both
 * functions are wrong in ways that read perfectly.
 *
 * @public
 */

/**
 * An ISO `YYYY-MM-DD` civil date.
 *
 * Not a `Date`. A `Date` is an instant, and an instant is only a date once you
 * say where you are standing — which is exactly the bug {@link muscatDate}
 * exists to prevent.
 */
export type CivilDate = string;

/**
 * Today's civil date **in Muscat**, whatever the server thinks the date is.
 *
 * Vercel runs in UTC; Muscat is UTC+4 with no DST. Between 20:00 and 23:59 UTC
 * it is already tomorrow in Oman — so a server reading its own date answers for
 * YESTERDAY for four hours every night. For the rotation, when those four hours
 * fall on a Saturday, that is the wrong WEEK. For a discount expiry, it is an
 * offer called dead for the last four hours of its final day.
 *
 * `en-CA` because its short date format is ISO `YYYY-MM-DD`; the alternative is
 * assembling parts by hand for no gain.
 */
export function muscatDate(instant: Date = new Date(), timeZone = "Asia/Muscat"): CivilDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Fold for comparison: case, punctuation and spacing all vary in how people type
 * "UI/UX", "ui ux" or "Data Engineering & Analytics".
 *
 * Folding is for EQUALITY, never for similarity. Every caller compares folded
 * strings with `===` — see `matchCoverage` for why a substring or fuzzy match is
 * a correctness problem here rather than a convenience.
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * §4.5's expiry states.
 *
 * `unspecified` is a real third state, not a stand-in for one of the other two.
 * §6.4's table has a partner whose validity is "Not specified" — calling that
 * valid invents a guarantee, and calling it expired hides a live offer.
 */
export type ExpiryState = "valid" | "expired" | "unspecified";

/**
 * Compare a stored expiry against a civil date.
 *
 * `validUntil` is a `@db.Date`, so Prisma returns midnight UTC on that civil
 * date. Comparing ISO strings keeps this in civil-date space rather than turning
 * it into an instant comparison that would be four hours out.
 *
 * "Valid until 30 September" includes the 30th — off by one here means HIVE
 * calls a live offer dead on its busiest day.
 */
export function expiryStateFor(validUntil: Date | null, today: CivilDate): ExpiryState {
  if (!validUntil) return "unspecified";
  const until = validUntil.toISOString().slice(0, 10);
  return until >= today ? "valid" : "expired";
}
