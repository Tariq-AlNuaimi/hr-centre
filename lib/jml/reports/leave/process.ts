import { prisma } from "@/lib/prisma";
import { workingDaysBetween } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { SETTLED_TASK_STATUSES } from "../../vocab";
import { emptyResult, loadLeaveRows, type LeaveReport } from "./base";
import { daysBetween, lowerMedian, mean, settlementBucket } from "./rules";

/** R6 active offboardings and delays, R7 final settlement status — process set only (non-migrated). */

export const r6Active: LeaveReport = {
  slug: "r6-active-delays",
  title: "R6 Active offboardings and delays",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(
      { ...ctx, filters: { ...ctx.filters, status: undefined } },
      {
        status: { in: ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT", "CLOSED"] },
        leaveDetail: { migrated: false },
      },
    );
    const live = rows.filter((r) => r.status !== "CLOSED");
    const calendar = await loadWorkingCalendar();
    const overdue = await prisma.jmlTask.findMany({
      where: {
        caseId: { in: live.map((r) => r.id) },
        dueDate: { lt: ctx.now },
        status: { notIn: [...SETTLED_TASK_STATUSES] },
      },
      select: { caseId: true, dueDate: true },
      take: 20_000,
    });
    const stages = [...new Set(live.map((r) => r.stage))].sort();
    const cells = stages.map((stage) => {
      const inStage = live.filter((r) => r.stage === stage);
      const ids = new Set(inStage.map((r) => r.id));
      const late = overdue.filter((t) => ids.has(t.caseId));
      return {
        stage,
        cases: inStage.length,
        avgProgressPct: mean(inStage.map((r) => r.completionPct)),
        overdueTasks: late.length,
        casesWithOverdueTasks: new Set(late.map((t) => t.caseId)).size,
        maxWorkingDaysDelayed: late.length
          ? Math.max(...late.map((t) => workingDaysBetween(t.dueDate!, ctx.now, calendar)))
          : 0,
      };
    });
    // AC-14.5: cycle time, notice start → closure, non-migrated closed cases only.
    const cycles = rows
      .filter((r) => r.status === "CLOSED" && r.closedAt)
      .map((r) => daysBetween(r.leaveDetail.noticeStartDate, r.closedAt!));
    const byStatus = ["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"]
      .map((s) => `${s}: ${live.filter((r) => r.status === s).length}`)
      .join(", ");
    return {
      ...emptyResult(),
      columns: [
        { key: "stage", title: "Stage" },
        { key: "cases", title: "Cases" },
        { key: "avgProgressPct", title: "Average progress %" },
        { key: "overdueTasks", title: "Overdue tasks" },
        { key: "casesWithOverdueTasks", title: "Cases with overdue tasks" },
        { key: "maxWorkingDaysDelayed", title: "Longest delay (working days)" },
      ],
      cells,
      summary: [
        { label: "Live cases by status", value: byStatus },
        { label: "Closed in period", value: cycles.length },
        { label: "Mean cycle time (days)", value: mean(cycles) },
        { label: "Median cycle time (days)", value: lowerMedian(cycles) },
      ],
      totalRecords: rows.length,
      migratedExcluded: await countMigrated(ctx),
      capReached,
    };
  },
};

async function countMigrated(ctx: Parameters<LeaveReport["run"]>[0]) {
  const { rows } = await loadLeaveRows(ctx, { leaveDetail: { migrated: true } });
  return rows.length;
}

export const r7Settlement: LeaveReport = {
  slug: "r7-settlement-status",
  title: "R7 Final settlement status",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx, {
      leaveDetail: { migrated: false },
      settlement: { isNot: null },
    });
    const buckets = [
      "PAID",
      "APPROVED_AWAITING_PAYMENT",
      "PROVISIONAL_UNVERIFIED_INPUTS",
      "AWAITING_APPROVAL",
    ];
    const days = (r: (typeof rows)[number]) =>
      r.settlement?.paymentConfirmedAt && r.leaveDetail.lastDayOfService
        ? daysBetween(r.leaveDetail.lastDayOfService, r.settlement.paymentConfirmedAt)
        : null;
    const cells = buckets.map((b) => {
      const inBucket = rows.filter((r) => settlementBucket(r.settlement!) === b);
      const d = inBucket.map(days).filter((x): x is number => x !== null);
      return {
        bucket: b,
        cases: inBucket.length,
        avgDaysLdsToPayment: mean(d),
        maxDaysLdsToPayment: d.length ? Math.max(...d) : null,
      };
    });
    const paid = rows.map(days).filter((x): x is number => x !== null);
    return {
      ...emptyResult(),
      columns: [
        { key: "bucket", title: "Status" },
        { key: "cases", title: "Cases" },
        { key: "avgDaysLdsToPayment", title: "Average days LDS → payment" },
        { key: "maxDaysLdsToPayment", title: "Longest days LDS → payment" },
      ],
      cells,
      summary: [
        { label: "Paid", value: paid.length },
        { label: "Average days to payment", value: mean(paid) },
        { label: "Median days to payment", value: lowerMedian(paid) },
        { label: "Longest", value: paid.length ? Math.max(...paid) : null },
      ],
      totalRecords: rows.length,
      capReached,
    };
  },
};
