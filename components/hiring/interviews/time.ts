/**
 * Interview times are shown in Muscat time (Interview Hub APP_TIME_ZONE), so a
 * panelist travelling abroad still reads the slot the candidate was given.
 */
const TZ = "Asia/Muscat";
const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const longDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function timeRange(start: string | Date, minutes: number): string {
  const from = new Date(start);
  const to = new Date(from.getTime() + (minutes > 0 ? minutes : 60) * 60_000);
  return `${hm.format(from)} – ${hm.format(to)}`;
}

export const timeOf = (d: string | Date) => hm.format(new Date(d));
/** "2026-10-27" in Muscat. */
export const dayKey = (d: string | Date) => ymd.format(new Date(d));
export const dayName = (d: string | Date) => longDay.format(new Date(d));
export const whenLabel = (d: string | Date) => stamp.format(new Date(d));

/** -1 yesterday, 0 today, 1 tomorrow, otherwise null. */
export function relativeDay(key: string, now = new Date()): -1 | 0 | 1 | null {
  const today = dayKey(now);
  const shift = (n: number) => dayKey(new Date(now.getTime() + n * 86_400_000));
  if (key === today) return 0;
  if (key === shift(1)) return 1;
  if (key === shift(-1)) return -1;
  return null;
}
