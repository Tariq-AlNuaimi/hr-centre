import { prisma } from "@/lib/prisma";
import type { ReportRange } from "@/lib/validations/hive/reports";
import { ageing, backlogTrend, perPerson, slaFigures, type SlaFigures } from "./report-sla";

/**
 * HIVE's reporting screen (spec V2 §5.5/§8.8, blueprint US-T7).
 *
 * COUNTS ONLY. Nothing here selects an employee's name, address or question:
 * the people who hold View reports are not necessarily the people who may read
 * tickets, and a report is the wrong place to learn who asked what.
 *
 * Every figure is an aggregate in the database — `groupBy`, or one of two
 * placeholder `$queryRaw` statements for what Prisma has no DSL for
 * (`date_trunc` buckets, a median) — so the cost is independent of how many
 * tickets the range holds. The range itself is capped at a year at the boundary.
 *
 * "Right now" figures (waiting on HR, awaiting approval) ignore the range: a
 * backlog is a fact about today, and a ticket opened last quarter that is still
 * open is exactly the one the tile exists to show. That also settles OQ-T3 —
 * Pending approval is its own figure, never part of "waiting on HR", so nothing
 * needs pausing.
 *
 * @public
 */

/** The statuses where the next move is HR's (drafting or resending). */
const WAITING_ON_HR = ["OPEN", "IN_PROGRESS", "SEND_FAILED"] as const;

/** The order a ticket moves through, for the status breakdown. */
const STATUS_ORDER = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "APPROVED",
  "SEND_FAILED",
  "SENT",
  "CLOSED",
];

/** Up to this many days the volume chart is daily; beyond it, weekly. */
const DAILY_MAX_DAYS = 92;

const DAY_MS = 86_400_000;

type Bucket = "day" | "week";

export interface TicketReport {
  range: { from: string; to: string; bucket: Bucket };
  tiles: {
    opened: number;
    waitingOnHr: number;
    awaitingApproval: number;
    answered: number;
    /** Median hours from opened to answer sent, for answers sent in range. */
    medianHoursToAnswer: number | null;
  };
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  byPair: { pairId: string; name: string; count: number }[];
  /** Oldest first, every bucket present (zero-filled). */
  volume: { bucket: string; count: number }[];
  /** P2-10 — first response vs resolution vs target, and approval turnaround. */
  sla: SlaFigures;
  /** P2-10 — open backlog at the end of each bucket. */
  backlog: { bucket: string; open: number }[];
  /** P2-10 — today's open tickets by age in days. */
  ageing: { band: string; count: number }[];
  /** P2-10 — per person: open now, overdue now, answered in range. */
  people: { userId: string; name: string; open: number; overdue: number; answered: number }[];
}

/**
 * Every bucket start between `from` and `to`, as `YYYY-MM-DD`. Weeks start on
 * Monday, matching Postgres's `date_trunc('week', …)`. Exported for the test.
 */
export function bucketStarts(from: string, to: string, bucket: Bucket): string[] {
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (bucket === "week") t -= ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  const step = bucket === "week" ? 7 * DAY_MS : DAY_MS;
  const out: string[] = [];
  for (; t <= end; t += step) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function volume(range: ReportRange, bucket: Bucket) {
  // Stored timestamps are UTC (`timestamp without time zone`); bucket them by
  // Muscat civil day so "Sunday" means HR's Sunday. The unit is chosen from a
  // two-value union above, never from the request.
  const rows = await prisma.$queryRaw<{ bucket: string; count: number }[]>`
    SELECT to_char(
             date_trunc(${bucket}, ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Muscat'),
             'YYYY-MM-DD'
           ) AS bucket,
           count(*)::int AS count
      FROM "hive_escalations"
     WHERE "createdAt" >= ${range.gte} AND "createdAt" < ${range.lt}
     GROUP BY 1
     ORDER BY 1`;
  const seen = new Map(rows.map((r) => [r.bucket, r.count]));
  return bucketStarts(range.from, range.to, bucket).map((b) => ({
    bucket: b,
    count: seen.get(b) ?? 0,
  }));
}

async function medianHoursToAnswer(range: ReportRange): Promise<number | null> {
  const [row] = await prisma.$queryRaw<{ hours: number | null }[]>`
    SELECT (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM ("sentAt" - "createdAt"))
            ) / 3600)::float8 AS hours
      FROM "hive_escalations"
     WHERE "sentAt" >= ${range.gte} AND "sentAt" < ${range.lt}`;
  const hours = row?.hours;
  return hours === null || hours === undefined ? null : Math.round(hours * 10) / 10;
}

export async function getTicketReport(range: ReportRange): Promise<TicketReport> {
  const opened = { createdAt: { gte: range.gte, lt: range.lt } };
  const bucket: Bucket = range.days <= DAILY_MAX_DAYS ? "day" : "week";

  const [
    openedCount,
    waitingOnHr,
    awaitingApproval,
    answered,
    median,
    byStatus,
    bySource,
    byPair,
    series,
    sla,
    backlog,
    ages,
    people,
  ] = await Promise.all([
    prisma.escalation.count({ where: opened }),
    prisma.escalation.count({ where: { status: { in: [...WAITING_ON_HR] } } }),
    prisma.escalation.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.escalation.count({ where: { sentAt: { gte: range.gte, lt: range.lt } } }),
    medianHoursToAnswer(range),
    // Bounded by the enums' cardinality; `take` states it for the scan.
    prisma.escalation.groupBy({
      by: ["status"],
      where: opened,
      _count: { _all: true },
      orderBy: { status: "asc" },
      take: 20,
    }),
    prisma.escalation.groupBy({
      by: ["source"],
      where: opened,
      _count: { _all: true },
      orderBy: { source: "asc" },
      take: 20,
    }),
    // A handful of HR pairs; 100 is the Scalable bound, not a real limit.
    prisma.escalation.groupBy({
      by: ["hrPairId"],
      where: opened,
      _count: { _all: true },
      orderBy: { hrPairId: "asc" },
      take: 100,
    }),
    volume(range, bucket),
    slaFigures(range),
    backlogTrend(bucketStarts(range.from, range.to, bucket), bucket),
    ageing(new Date()),
    perPerson(range, new Date()),
  ]);

  // Pair names in one query, not one per bar.
  const pairs = await prisma.hrTagPair.findMany({
    where: { id: { in: byPair.map((p) => p.hrPairId) } },
    select: { id: true, name: true },
    take: 100,
  });
  const pairName = new Map(pairs.map((p) => [p.id, p.name]));

  return {
    range: { from: range.from, to: range.to, bucket },
    tiles: {
      opened: openedCount,
      waitingOnHr,
      awaitingApproval,
      answered,
      medianHoursToAnswer: median,
    },
    // Workflow order, not the database enum's (whose later additions sort last).
    byStatus: byStatus
      .map((r) => ({ status: r.status, count: r._count._all }))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    bySource: bySource.map((r) => ({ source: r.source, count: r._count._all })),
    byPair: byPair
      .map((r) => ({
        pairId: r.hrPairId,
        name: pairName.get(r.hrPairId) ?? "—",
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    volume: series,
    sla,
    backlog,
    ageing: ages,
    people,
  };
}
