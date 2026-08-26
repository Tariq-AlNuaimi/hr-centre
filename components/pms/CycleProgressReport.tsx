"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";

/**
 * §13.5 — "Cycle-progress / completion tracking — org-wide status."
 *
 * Three layers, narrowest last: the two headline percentages, then the
 * per-department breakdown, then the named list of people whose goal-setting is
 * unfinished. HR reads this top-down when asking "are we on track", and
 * bottom-up when asking "who do I chase" — the order supports both without a
 * filter.
 */

type Completion = { done: number; total: number; percent: number };

interface ProgressResponse {
  cycle: {
    id: string;
    year: number;
    status: string;
    stages: Array<{ kind: string; opensAt: string; deadline: string; state: string }>;
  };
  participantCount: number;
  progress: Array<{ stageKind: string; completion: Completion }>;
  byDepartment: Array<{
    name: string | null;
    count: number;
    goalSetting: Completion;
    yearEnd: Completion;
  }>;
  byEntity: Array<{
    name: string | null;
    count: number;
    goalSetting: Completion;
    yearEnd: Completion;
  }>;
  outstanding: Array<{
    employeeId: string;
    name: string;
    managerName: string | null;
    department: string | null;
    state: string;
    outstandingLabel: string | null;
  }>;
}

type GroupRow = ProgressResponse["byDepartment"][number] & { key: string };

export function CycleProgressReport({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.reports.progress");
  const tTeam = useTranslations("pms.team");

  const query = useQuery({
    queryKey: ["pms", "report", "progress", cycleId],
    queryFn: () =>
      apiClient.get<ProgressResponse>(`/api/reports/cycle-progress?cycleId=${cycleId}`),
  });

  if (query.isLoading) return <TableSkeleton />;
  if (query.isError || !query.data) {
    return (
      <SectionCard title={t("loadFailed")}>
        <EmptyState description={t("loadFailedHelp")} />
      </SectionCard>
    );
  }

  const data = query.data;
  const goal = data.progress.find((p) => p.stageKind === "GOAL_SETTING")?.completion;
  const year = data.progress.find((p) => p.stageKind === "YEAR_END")?.completion;

  // Departments and entities render through the same table: the columns are
  // identical, and two components would be two places to change a label.
  const groupColumns = [
    {
      key: "name",
      title: t("group"),
      // A null name is §1.2's C-Level, who have no department. Named rather than
      // blank, so the rows visibly reconcile to the participant count.
      render: (_v: unknown, row: GroupRow) => row.name ?? t("noDepartment"),
    },
    { key: "count", title: t("headcount"), render: (_v: unknown, row: GroupRow) => row.count },
    {
      key: "goal",
      title: tTeam("goalSetting"),
      render: (_v: unknown, row: GroupRow) => (
        <span>
          {row.goalSetting.percent}%{" "}
          <span className="text-xs text-muted-foreground">
            ({row.goalSetting.done}/{row.goalSetting.total})
          </span>
        </span>
      ),
    },
    {
      key: "year",
      title: tTeam("yearEnd"),
      render: (_v: unknown, row: GroupRow) => (
        <span>
          {row.yearEnd.percent}%{" "}
          <span className="text-xs text-muted-foreground">
            ({row.yearEnd.done}/{row.yearEnd.total})
          </span>
        </span>
      ),
    },
  ];

  const keyed = (rows: ProgressResponse["byDepartment"]): GroupRow[] =>
    rows.map((row, index) => ({ ...row, key: row.name ?? `unassigned-${index}` }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("participants")} value={data.participantCount} />
        <StatCard
          title={tTeam("goalSetting")}
          value={goal ? `${goal.percent}%` : "—"}
          hint={goal ? t("ofTotal", { done: goal.done, total: goal.total }) : ""}
        />
        <StatCard
          title={tTeam("yearEnd")}
          value={year ? `${year.percent}%` : "—"}
          hint={year ? t("ofTotal", { done: year.done, total: year.total }) : ""}
        />
      </div>

      <SectionCard title={t("stages")}>
        <ul className="space-y-2 text-sm">
          {data.cycle.stages.map((stage) => (
            <li key={stage.kind} className="flex items-center justify-between gap-3">
              <span>{tTeam(`stage.${stage.kind}`)}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(stage.deadline).toLocaleDateString()}
                </span>
                <Badge variant={stage.state === "LOCKED" ? "danger" : "outline"}>
                  {t(`stageState.${stage.state}`)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("byDepartment")} noBodyPadding>
        <DataTable<GroupRow>
          rowKey="key"
          dataSource={keyed(data.byDepartment)}
          total={data.byDepartment.length}
          page={1}
          pageSize={data.byDepartment.length || 1}
          columns={groupColumns}
        />
      </SectionCard>

      <SectionCard title={t("byEntity")} noBodyPadding>
        <DataTable<GroupRow>
          rowKey="key"
          dataSource={keyed(data.byEntity)}
          total={data.byEntity.length}
          page={1}
          pageSize={data.byEntity.length || 1}
          columns={groupColumns}
        />
      </SectionCard>

      <SectionCard title={t("outstanding")} subtitle={t("outstandingHelp")} noBodyPadding>
        {data.outstanding.length === 0 ? (
          <div className="p-6">
            <EmptyState description={t("noneOutstanding")} />
          </div>
        ) : (
          <DataTable<ProgressResponse["outstanding"][number]>
            rowKey="employeeId"
            dataSource={data.outstanding}
            total={data.outstanding.length}
            page={1}
            pageSize={data.outstanding.length}
            columns={[
              { key: "name", title: t("employee"), dataIndex: "name" },
              { key: "department", title: t("group"), dataIndex: "department" },
              { key: "managerName", title: t("manager"), dataIndex: "managerName" },
              {
                key: "state",
                title: t("state"),
                render: (_v: unknown, row: ProgressResponse["outstanding"][number]) => (
                  <div className="space-y-1">
                    <Badge variant="warning">{tTeam(`state.${row.state}`)}</Badge>
                    {row.outstandingLabel && (
                      <div className="text-xs text-destructive-emphasis">
                        {tTeam(`outstandingLabel.${row.outstandingLabel}`)}
                      </div>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
