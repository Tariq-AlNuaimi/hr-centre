import { prisma } from "@/lib/prisma";
import { zonedToday } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { SETTLED_TASK_STATUSES } from "../vocab";
import {
  CASE_IDENTITY,
  ROW_LIMIT,
  col,
  joinWhere,
  monthRange,
  runCaseReport,
  type ReportDefinition,
} from "./join-base";

/** The case-level onboarding reports (§13.1 rows 1, 3, 4, 5, 6). */

const salaryCol = (include: boolean) => (include ? [col("Salary", "salary", 12)] : []);

export const monthlyOnboarding: ReportDefinition = {
  slug: "monthly-onboarding",
  salaryCapable: true,
  run: (ctx) =>
    runCaseReport(
      {
        ...ctx,
        filters: {
          ...ctx.filters,
          joiningMonth: ctx.filters.joiningMonth ?? ctx.now.toISOString().slice(0, 7),
        },
      },
      true,
    ),
  columns: (s) => [
    ...CASE_IDENTITY,
    col("Job title", "jobTitle", 24),
    col("Employment type", "employmentType", 20),
    col("Planned start", "plannedStartDate", 14),
    col("Actual start", "actualStartDate", 14),
    col("Stage", "stage", 14),
    col("Status", "status", 12),
    col("Completion %", "completionPct", 13),
    ...salaryCol(s),
  ],
};

export const onboardingCompletion: ReportDefinition = {
  slug: "onboarding-completion",
  salaryCapable: false,
  run: async (ctx) => {
    const rows = await prisma.jmlCase.findMany({
      where: joinWhere(ctx, { status: ctx.filters.status ?? "ACTIVE" }),
      select: {
        caseRef: true,
        stage: true,
        status: true,
        completionPct: true,
        activatedAt: true,
        hrOwner: { select: { name: true } },
        joinDetail: { select: { plannedStartDate: true } },
        employee: {
          select: {
            name: true,
            employeeCode: true,
            entity: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        tasks: {
          where: { status: { not: "CANCELLED" } },
          select: { status: true, mandatory: true },
          take: 500,
        },
      },
      orderBy: { completionPct: "asc" },
      take: ROW_LIMIT,
    });
    return rows.map((r) => {
      const applicable = r.tasks.filter((t) => t.status !== "NOT_APPLICABLE");
      return {
        caseRef: r.caseRef,
        fullName: r.employee.name,
        employeeCode: r.employee.employeeCode,
        company: r.employee.entity.name,
        department: r.employee.department?.name ?? null,
        owner: r.hrOwner?.name ?? null,
        stage: r.stage,
        status: r.status,
        completionPct: r.completionPct,
        tasksDone: applicable.filter((t) => t.status === "COMPLETED").length,
        tasksTotal: applicable.length,
        mandatoryOutstanding: applicable.filter((t) => t.mandatory && t.status !== "COMPLETED")
          .length,
        plannedStartDate: r.joinDetail?.plannedStartDate?.toISOString().slice(0, 10) ?? null,
        activatedAt: r.activatedAt?.toISOString().slice(0, 10) ?? null,
      };
    });
  },
  columns: () => [
    ...CASE_IDENTITY,
    col("Stage", "stage", 14),
    col("Completion %", "completionPct", 13),
    col("Tasks done", "tasksDone", 12),
    col("Tasks applicable", "tasksTotal", 16),
    col("Mandatory outstanding", "mandatoryOutstanding", 21),
    col("Planned start", "plannedStartDate", 14),
    col("Activated", "activatedAt", 14),
  ],
};

export const delayedTasks: ReportDefinition = {
  slug: "delayed-tasks",
  salaryCapable: false,
  run: async (ctx) => {
    const today = zonedToday(ctx.now, (await loadSchedule()).timeZone);
    const rows = await prisma.jmlTask.findMany({
      where: {
        OR: [{ status: "DELAYED" }, { dueDate: { lt: today } }],
        status: { notIn: [...SETTLED_TASK_STATUSES] },
        case: joinWhere(ctx, { status: ctx.filters.status ?? "ACTIVE" }),
      },
      select: {
        name: true,
        stage: true,
        status: true,
        dueDate: true,
        delayReason: true,
        statutory: true,
        case: {
          select: {
            caseRef: true,
            hrOwner: { select: { name: true } },
            employee: {
              select: {
                name: true,
                employeeCode: true,
                entity: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
      take: ROW_LIMIT,
    });
    return rows.map((r) => ({
      caseRef: r.case.caseRef,
      fullName: r.case.employee.name,
      employeeCode: r.case.employee.employeeCode,
      company: r.case.employee.entity.name,
      department: r.case.employee.department?.name ?? null,
      owner: r.case.hrOwner?.name ?? null,
      task: r.name,
      stage: r.stage,
      status: r.status,
      statutory: r.statutory ? "Yes" : "No",
      dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null,
      delayReason: r.delayReason,
    }));
  },
  columns: () => [
    ...CASE_IDENTITY,
    col("Task", "task", 30),
    col("Stage", "stage", 14),
    col("Status", "status", 16),
    col("Statutory", "statutory", 11),
    col("Due", "dueDate", 14),
    col("Delay reason", "delayReason", 34),
  ],
};

export const upcomingJoiners: ReportDefinition = {
  slug: "upcoming-joiners",
  salaryCapable: true,
  run: async (ctx) => {
    const today = zonedToday(ctx.now, (await loadSchedule()).timeZone);
    const window = ctx.filters.joiningMonth ? monthRange(ctx.filters.joiningMonth) : { gte: today };
    const rows = await runCaseReport(
      { ...ctx, filters: { ...ctx.filters, joiningMonth: undefined } },
      true,
      {
        status: ctx.filters.status ?? "ACTIVE",
        joinDetail: { plannedStartDate: window },
      },
    );
    return rows.sort((a, b) =>
      String(a.plannedStartDate).localeCompare(String(b.plannedStartDate)),
    );
  },
  columns: (s) => [
    ...CASE_IDENTITY,
    col("Job title", "jobTitle", 24),
    col("Employment type", "employmentType", 20),
    col("Planned start", "plannedStartDate", 14),
    col("Stage", "stage", 14),
    col("Completion %", "completionPct", 13),
    ...salaryCol(s),
  ],
};

export const completedOnboardings: ReportDefinition = {
  slug: "completed-onboardings",
  salaryCapable: true,
  run: async (ctx) => {
    const rows = await runCaseReport(
      { ...ctx, filters: { ...ctx.filters, status: undefined } },
      true,
      {
        status: "COMPLETED",
      },
    );
    return rows.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  },
  columns: (s) => [
    ...CASE_IDENTITY,
    col("Job title", "jobTitle", 24),
    col("Employment type", "employmentType", 20),
    col("Planned start", "plannedStartDate", 14),
    col("Actual start", "actualStartDate", 14),
    col("Activated", "activatedAt", 14),
    col("Completed", "completedAt", 14),
    ...salaryCol(s),
  ],
};
