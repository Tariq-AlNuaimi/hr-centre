import { prisma } from "@/lib/prisma";
import { DEFAULT_SCHEDULE, dayKey, type WorkingCalendar, type WorkingSchedule } from "./calendar";

/**
 * Loads the ONE working calendar (ADR-077): the schedule singleton (absent row =
 * the Sun–Thu 08:00–17:00 Asia/Muscat default) and the public holidays in a
 * bounded window around today — due dates are computed within a couple of
 * years of now, and the read stays one indexed range query.
 */

const HOLIDAY_WINDOW_YEARS = 3;
const MAX_HOLIDAYS = 1000;

export async function loadSchedule(): Promise<WorkingSchedule> {
  const row = await prisma.workingSchedule.findUnique({
    where: { singleton: "singleton" },
    select: { workingDays: true, startHour: true, endHour: true, timeZone: true },
  });
  return row ?? DEFAULT_SCHEDULE;
}

export async function loadWorkingCalendar(now: Date = new Date()): Promise<WorkingCalendar> {
  const year = now.getUTCFullYear();
  const [schedule, holidays] = await Promise.all([
    loadSchedule(),
    prisma.publicHoliday.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(year - HOLIDAY_WINDOW_YEARS, 0, 1)),
          lte: new Date(Date.UTC(year + HOLIDAY_WINDOW_YEARS, 11, 31)),
        },
      },
      select: { date: true },
      orderBy: { date: "asc" },
      take: MAX_HOLIDAYS,
    }),
  ]);
  return { schedule, holidays: new Set(holidays.map((h) => dayKey(h.date))) };
}
