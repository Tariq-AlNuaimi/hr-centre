import { prisma } from "@/lib/prisma";
import { zonedToday } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { listJmlHrUsers } from "../engine/assignment";
import { SETTLED_TASK_STATUSES } from "../vocab";
import { monthBuckets } from "./months";
import { ROW_LIMIT, col, goLiveDate, joinWhere, type ReportDefinition } from "./join-base";

/** The aggregate onboarding reports (§13.1 rows 2, 7, 8). */

export const hrWorkload: ReportDefinition = {
  slug: "hr-workload",
  salaryCapable: false,
  run: async (ctx) => {
    const scope = joinWhere({ ...ctx, filters: { ...ctx.filters, status: undefined } });
    const today = zonedToday(ctx.now, (await loadSchedule()).timeZone);
    const [owners, byStatus, overdue] = await Promise.all([
      listJmlHrUsers(),
      prisma.jmlCase.groupBy({
        by: ["hrOwnerUserId", "status"],
        where: scope,
        _count: { _all: true },
        _avg: { completionPct: true },
      }),
      prisma.jmlTask.groupBy({
        by: ["ownerUserId"],
        where: {
          status: { notIn: [...SETTLED_TASK_STATUSES] },
          dueDate: { lt: today },
          case: { AND: [scope, { status: "ACTIVE" }] },
        },
        _count: { _all: true },
      }),
    ]);
    const overdueBy = new Map(overdue.map((o) => [o.ownerUserId, o._count._all]));
    return owners.map((owner) => {
      const mine = byStatus.filter((g) => g.hrOwnerUserId === owner.id);
      const count = (s: string) => mine.find((g) => g.status === s)?._count._all ?? 0;
      const active = mine.find((g) => g.status === "ACTIVE");
      return {
        owner: owner.name ?? owner.email,
        role: owner.supervises ? "Senior" : "Officer",
        active: count("ACTIVE"),
        overdueTasks: overdueBy.get(owner.id) ?? 0,
        avgCompletionPct: Math.round(active?._avg.completionPct ?? 0),
        completed: count("COMPLETED"),
        cancelled: count("CANCELLED"),
        draft: count("DRAFT"),
      };
    });
  },
  columns: () => [
    col("HR officer", "owner", 24),
    col("Role", "role", 16),
    col("Active cases", "active", 13),
    col("Overdue tasks", "overdueTasks", 14),
    col("Avg completion % (active)", "avgCompletionPct", 24),
    col("Completed", "completed", 12),
    col("Cancelled", "cancelled", 12),
    col("Draft", "draft", 10),
  ],
};

export const volumeTrend: ReportDefinition = {
  slug: "onboarding-volume-trend",
  salaryCapable: false,
  run: async (ctx) => {
    const goLive = await goLiveDate();
    if (!goLive) return [];
    const f = ctx.filters;
    const rows = await prisma.jmlCase.findMany({
      where: joinWhere(
        { ...ctx, filters: { ...f, from: undefined, to: undefined } },
        {
          activatedAt: {
            gte: f.from && f.from > goLive ? f.from : goLive,
            ...(f.to ? { lte: f.to } : {}),
          },
        },
      ),
      select: { activatedAt: true, status: true },
      take: ROW_LIMIT,
    });
    const last = rows.reduce(
      (max, r) => (r.activatedAt && r.activatedAt > max ? r.activatedAt : max),
      goLive,
    );
    const buckets = new Map(
      monthBuckets(goLive, last).map((m) => [m, { activated: 0, completed: 0, cancelled: 0 }]),
    );
    for (const r of rows) {
      const b = r.activatedAt ? buckets.get(r.activatedAt.toISOString().slice(0, 7)) : undefined;
      if (!b) continue;
      b.activated += 1;
      if (r.status === "COMPLETED") b.completed += 1;
      if (r.status === "CANCELLED") b.cancelled += 1;
    }
    return [...buckets.entries()].map(([month, b]) => ({ month, ...b }));
  },
  columns: () => [
    col("Month", "month", 12),
    col("Onboardings started", "activated", 20),
    col("Completed", "completed", 12),
    col("Cancelled", "cancelled", 12),
  ],
};

export const allCompanies: ReportDefinition = {
  slug: "all-companies",
  salaryCapable: false,
  run: async (ctx) => {
    const scope = joinWhere({
      ...ctx,
      filters: { ...ctx.filters, entityId: undefined, status: undefined },
    });
    const [companies, cases] = await Promise.all([
      prisma.orgEntity.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 100,
      }),
      prisma.jmlCase.findMany({
        where: scope,
        select: { status: true, completionPct: true, employee: { select: { entityId: true } } },
        take: ROW_LIMIT,
      }),
    ]);
    return companies.map((company) => {
      const mine = cases.filter((c) => c.employee.entityId === company.id);
      const active = mine.filter((c) => c.status === "ACTIVE");
      const avg = active.length
        ? Math.round(active.reduce((s, c) => s + c.completionPct, 0) / active.length)
        : 0;
      return {
        company: company.name,
        total: mine.length,
        active: active.length,
        avgCompletionPct: avg,
        completed: mine.filter((c) => c.status === "COMPLETED").length,
        cancelled: mine.filter((c) => c.status === "CANCELLED").length,
        draft: mine.filter((c) => c.status === "DRAFT").length,
      };
    });
  },
  columns: () => [
    col("Company", "company", 26),
    col("Total onboardings", "total", 18),
    col("Active", "active", 10),
    col("Avg completion % (active)", "avgCompletionPct", 24),
    col("Completed", "completed", 12),
    col("Cancelled", "cancelled", 12),
    col("Draft", "draft", 10),
  ],
};
