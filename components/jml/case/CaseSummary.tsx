"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { daysUntil } from "@/lib/format";
import { DateText, DueLabel, RagBadge } from "../CaseBits";
import type { CaseDetail, TaskDto } from "./types";

const SETTLED = new Set(["COMPLETED", "NOT_APPLICABLE", "CANCELLED"]);

function useTasks(caseId: string) {
  // Same query the checklist uses — one request serves both.
  return useQuery({
    queryKey: ["jml", "case", caseId, "tasks"],
    queryFn: () => apiClient.get<TaskDto[]>(`/api/jml/cases/${caseId}/tasks`),
  });
}

/** The case's key dates by type: start, effective date, or the leaver's three dates. */
function keyDates(c: CaseDetail): Array<[string, string | null]> {
  if (c.caseType === "JOIN")
    return [
      ["plannedStart", c.joinDetail?.plannedStartDate ?? null],
      ["actualStart", c.joinDetail?.actualStartDate ?? null],
    ];
  if (c.caseType === "MOVE") return [["effective", c.moveDetail?.effectiveDate ?? null]];
  return [
    ["noticeStart", c.leaveDates?.noticeStartDate ?? null],
    ["lastPhysicalDay", c.leaveDates?.lastPhysicalWorkingDay ?? null],
    ["lastDayOfService", c.leaveDates?.lastDayOfService ?? null],
  ];
}

/**
 * The case at a glance (UX P1 perf-jml P1-3a — what the old Offboarding
 * Overview opened on): key dates, owner, risk, the next task due, overdue and
 * blocking counts. Stays above the tabs whatever tab is open.
 */
export function CaseSummary({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.summary");
  const tasks = useTasks(detail.id);
  const open = (tasks.data ?? []).filter((x) => !SETTLED.has(x.status));
  const overdue = open.filter((x) => x.dueDate && daysUntil(x.dueDate) < 0).length;
  const blocking = open.filter((x) => x.blocking).length;
  const next = open
    .filter((x) => x.dueDate)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const item = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm text-foreground">{value}</dd>
    </div>
  );
  return (
    <dl className="sticky top-0 z-10 grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
      {keyDates(detail).map(([key, value]) => item(t(key), <DateText value={value} />))}
      {item(t("owner"), detail.hrOwner?.name ?? t("noOwner"))}
      {item(t("risk"), <RagBadge flag={detail.ragFlag} status={detail.status} />)}
      {item(
        t("nextDue"),
        next ? (
          <span>
            {next.code} · <DueLabel value={next.dueDate} />
          </span>
        ) : (
          t("nothingDue")
        ),
      )}
      {item(t("overdue"), tasks.isLoading ? "…" : String(overdue))}
      {item(t("blocking"), tasks.isLoading ? "…" : String(blocking))}
    </dl>
  );
}

/** Open-task count on the Checklist tab label. */
export function OpenCount({ caseId }: { caseId: string }) {
  const tasks = useTasks(caseId);
  if (!tasks.data) return null;
  const n = tasks.data.filter((x) => !SETTLED.has(x.status)).length;
  return <span className="ms-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums">{n}</span>;
}
