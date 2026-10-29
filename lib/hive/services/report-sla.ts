import { prisma } from "@/lib/prisma";
import { formatTicketId } from "@/lib/hive/ticket-id";
import type { ReportRange } from "@/lib/validations/hive/reports";

/**
 * P2-10 — the service-level half of the ticket reports: first response vs
 * resolution vs the answer-by target, approval turnaround, backlog and ageing,
 * per-person load, and the CSV rows. Every query is an aggregate or bounded,
 * and the raw SQL takes only bound parameters (no interpolated identifiers).
 *
 * "Resolution" is the answer being SENT (`sentAt`); "first response" is the
 * first message from HR (`firstResponseAt`); the target is `dueAt`, the
 * answer-by date the ticket clock sets.
 */

const DAY_MS = 86_400_000;
const OPEN = ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL", "APPROVED", "SEND_FAILED"] as const;

export type SlaFigures = {
  medianFirstResponseHours: number | null;
  medianResolutionHours: number | null;
  medianApprovalHours: number | null;
  answeredOnTime: number;
  answeredLate: number;
  answeredNoTarget: number;
};

const round1 = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * 10) / 10;

export async function slaFigures(range: ReportRange): Promise<SlaFigures> {
  const [row] = await prisma.$queryRaw<
    {
      first: number | null;
      resolution: number | null;
      on_time: number;
      late: number;
      no_target: number;
    }[]
  >`
    SELECT
      (percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM ("first_response_at" - "createdAt"))) / 3600)::float8 AS first,
      (percentile_cont(0.5) WITHIN GROUP (
         ORDER BY extract(epoch FROM ("sentAt" - "createdAt"))) / 3600)::float8 AS resolution,
      count(*) FILTER (WHERE "due_at" IS NOT NULL AND "sentAt" <= "due_at")::int AS on_time,
      count(*) FILTER (WHERE "due_at" IS NOT NULL AND "sentAt" > "due_at")::int AS late,
      count(*) FILTER (WHERE "due_at" IS NULL)::int AS no_target
    FROM "hive_escalations"
    WHERE "sentAt" >= ${range.gte} AND "sentAt" < ${range.lt}`;
  const [approval] = await prisma.$queryRaw<{ hours: number | null }[]>`
    SELECT (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM ("approvedAt" - "submittedAt"))) / 3600)::float8 AS hours
      FROM "hive_escalations"
     WHERE "approvedAt" >= ${range.gte} AND "approvedAt" < ${range.lt}
       AND "submittedAt" IS NOT NULL`;
  return {
    medianFirstResponseHours: round1(row?.first),
    medianResolutionHours: round1(row?.resolution),
    medianApprovalHours: round1(approval?.hours),
    answeredOnTime: row?.on_time ?? 0,
    answeredLate: row?.late ?? 0,
    answeredNoTarget: row?.no_target ?? 0,
  };
}

/**
 * Open backlog at the END of each bucket: opened by then, and not yet sent
 * (closed-without-answer tickets leave the backlog when last updated).
 * One query over the range's tickets, counted per bucket in memory.
 */
export async function backlogTrend(
  bucketStarts: readonly string[],
  bucket: "day" | "week",
): Promise<{ bucket: string; open: number }[]> {
  if (bucketStarts.length === 0) return [];
  const step = bucket === "week" ? 7 * DAY_MS : DAY_MS;
  const ends = bucketStarts.map((b) => new Date(Date.parse(`${b}T00:00:00+04:00`) + step));
  const first = new Date(Date.parse(`${bucketStarts[0]}T00:00:00+04:00`));
  const last = ends[ends.length - 1];
  const rows = await prisma.escalation.findMany({
    where: {
      createdAt: { lt: last },
      OR: [
        { sentAt: null, status: { in: [...OPEN] } },
        { sentAt: { gte: first } },
        { status: "CLOSED", updatedAt: { gte: first } },
      ],
    },
    select: { createdAt: true, sentAt: true, status: true, updatedAt: true },
    take: 20000,
  });
  return bucketStarts.map((b, i) => {
    const end = ends[i];
    const open = rows.filter((r) => {
      if (r.createdAt >= end) return false;
      if (r.sentAt) return r.sentAt >= end;
      if (r.status === "CLOSED" || r.status === "SENT") return r.updatedAt >= end;
      return true;
    }).length;
    return { bucket: b, open };
  });
}

export const AGE_BANDS = ["0-2", "3-7", "8-14", "15+"] as const;

/** How old today's open tickets are, in days, banded. */
export async function ageing(now: Date): Promise<{ band: string; count: number }[]> {
  const rows = await prisma.escalation.findMany({
    where: { status: { in: [...OPEN] } },
    select: { createdAt: true },
    take: 20000,
  });
  const out = new Map<string, number>(AGE_BANDS.map((b) => [b, 0]));
  for (const r of rows)
    out.set(ageBand(r.createdAt, now), (out.get(ageBand(r.createdAt, now)) ?? 0) + 1);
  return AGE_BANDS.map((band) => ({ band, count: out.get(band) ?? 0 }));
}

export function ageBand(createdAt: Date, now: Date): (typeof AGE_BANDS)[number] {
  const days = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);
  if (days <= 2) return "0-2";
  if (days <= 7) return "3-7";
  if (days <= 14) return "8-14";
  return "15+";
}

/** Per person: open tickets assigned now, overdue among them, and answers drafted in range. */
export async function perPerson(range: ReportRange, now: Date) {
  const [open, overdue, drafted] = await Promise.all([
    prisma.escalation.groupBy({
      by: ["assigneeId"],
      where: { status: { in: [...OPEN] }, assigneeId: { not: null } },
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
      take: 200,
    }),
    prisma.escalation.groupBy({
      by: ["assigneeId"],
      where: { status: { in: [...OPEN] }, assigneeId: { not: null }, dueAt: { lt: now } },
      _count: { _all: true },
      orderBy: { assigneeId: "asc" },
      take: 200,
    }),
    prisma.escalation.groupBy({
      by: ["draftedById"],
      where: { sentAt: { gte: range.gte, lt: range.lt }, draftedById: { not: null } },
      _count: { _all: true },
      orderBy: { draftedById: "asc" },
      take: 200,
    }),
  ]);
  const ids = [
    ...new Set([...open.map((r) => r.assigneeId!), ...drafted.map((r) => r.draftedById!)]),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
    take: 400,
  });
  const name = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const overdueOf = new Map(overdue.map((r) => [r.assigneeId!, r._count._all]));
  const openOf = new Map(open.map((r) => [r.assigneeId!, r._count._all]));
  const draftedOf = new Map(drafted.map((r) => [r.draftedById!, r._count._all]));
  return ids
    .map((id) => ({
      userId: id,
      name: name.get(id) ?? "—",
      open: openOf.get(id) ?? 0,
      overdue: overdueOf.get(id) ?? 0,
      answered: draftedOf.get(id) ?? 0,
    }))
    .sort((a, b) => b.open - a.open || b.answered - a.answered);
}

const CSV_MAX_ROWS = 5000;

/**
 * The CSV export: one row per ticket opened in the range. Deliberately no
 * employee name, email or question text — the report is about service levels,
 * and the export leaves the system.
 */
export async function reportCsvRows(range: ReportRange) {
  return prisma.escalation.findMany({
    where: { createdAt: { gte: range.gte, lt: range.lt } },
    orderBy: { ticketNumber: "asc" },
    take: CSV_MAX_ROWS,
    select: {
      ticketNumber: true,
      status: true,
      source: true,
      createdAt: true,
      firstResponseAt: true,
      submittedAt: true,
      approvedAt: true,
      sentAt: true,
      dueAt: true,
      hrPair: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
}

const hoursBetween = (a: Date | null, b: Date | null) =>
  a && b ? (Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10).toString() : "";

/** RFC 4180 field: quoted when needed; a leading formula character is neutralised. */
export function csvField(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Awaited<ReturnType<typeof reportCsvRows>>, prefix: string): string {
  const header = [
    "ticket",
    "status",
    "source",
    "hr_pair",
    "assignee",
    "opened_at",
    "answer_by",
    "first_response_at",
    "sent_at",
    "hours_to_first_response",
    "hours_to_answer",
    "hours_in_approval",
    "on_time",
  ];
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const lines = rows.map((r) =>
    [
      formatTicketId(r.ticketNumber, prefix),
      r.status,
      r.source,
      r.hrPair?.name ?? "",
      r.assignee?.name ?? "",
      iso(r.createdAt),
      iso(r.dueAt),
      iso(r.firstResponseAt),
      iso(r.sentAt),
      hoursBetween(r.createdAt, r.firstResponseAt),
      hoursBetween(r.createdAt, r.sentAt),
      hoursBetween(r.submittedAt, r.approvedAt),
      r.sentAt && r.dueAt ? (r.sentAt <= r.dueAt ? "yes" : "no") : "",
    ]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
