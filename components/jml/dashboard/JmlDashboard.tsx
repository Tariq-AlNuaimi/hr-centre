"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { FilterChips } from "@/components/shared/FilterBar";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess } from "../use-jml";
import { TaskLines, type WorkTask } from "./TaskLines";

type Dashboard = {
  scope: "mine" | "all";
  summary: {
    liveJoiners: number;
    liveMovers: number;
    liveLeavers: number;
    joiningThisMonth: number;
    exitsThisMonth: number;
    averageCompletion: number | null;
  };
  myWork: WorkTask[];
  myWorkTotal: number;
  awaitingApproval: Array<{
    id: string;
    approvalType: string;
    holderRoleKey: string;
    requestedAt: string;
    case: { id: string; caseRef: string; employee: { name: string } };
  }>;
  statutoryWatch: Array<{
    caseId: string;
    caseRef: string;
    name: string;
    what: string;
    daysLeft: number;
  }>;
  delayedTasks: Array<WorkTask & { owner: { name: string | null } | null }>;
  exitReasons: Array<{ level1: string; exits: number }>;
};

/** The JML landing: what is live, what is mine, what is late, what is waiting. */
export function JmlDashboard() {
  const t = useTranslations("jml.dashboard");
  const { can, isLoading } = useJmlAccess();
  const [scope, setScope] = useState<"" | "mine" | "all">("");
  const q = useQuery({
    queryKey: ["jml", "dashboard", scope],
    queryFn: () =>
      apiClient.get<Dashboard | null>(`/api/jml/dashboard${scope ? `?scope=${scope}` : ""}`),
    enabled: can("jml.view"),
  });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.view")) return <NotPermitted title={t("title")} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <FilterChips
            label={t("scope")}
            value={scope || d?.scope || ""}
            onChange={(v) => setScope(v as "mine" | "all")}
            chips={[
              { value: "mine", label: t("mine") },
              { value: "all", label: t("all") },
            ]}
          />
        }
      />
      {q.isLoading ? <LoadingBlock /> : null}
      {q.isError ? <LoadFailed /> : null}
      {d ? <Body d={d} /> : null}
    </div>
  );
}

function Body({ d }: { d: Dashboard }) {
  const t = useTranslations("jml.dashboard");
  const s = d.summary;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard title={t("liveJoiners")} value={s.liveJoiners} />
        <StatCard title={t("liveMovers")} value={s.liveMovers} />
        <StatCard title={t("liveLeavers")} value={s.liveLeavers} />
        <StatCard title={t("joiningThisMonth")} value={s.joiningThisMonth} />
        <StatCard title={t("exitsThisMonth")} value={s.exitsThisMonth} />
        <StatCard
          title={t("averageCompletion")}
          value={s.averageCompletion === null ? "—" : `${s.averageCompletion}%`}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={t("myWork")}
          actions={
            <Link href="/jml/my-tasks" className="text-sm text-primary hover:underline">
              {t("allMyTasksCount", { count: d.myWorkTotal })}
            </Link>
          }
        >
          <TaskLines tasks={d.myWork} empty={t("noWork")} />
        </SectionCard>
        <SectionCard title={t("delayed")}>
          <TaskLines tasks={d.delayedTasks} empty={t("noDelayed")} showOwner />
        </SectionCard>
        <SectionCard title={t("approvals")}>
          {d.awaitingApproval.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noApprovals")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.awaitingApproval.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/jml/cases/${a.case.id}?tab=approvals`}
                    className="font-medium text-primary hover:underline"
                  >
                    {a.case.caseRef}
                  </Link>{" "}
                  {t("approvalLine", {
                    name: a.case.employee.name,
                    holder: a.holderRoleKey,
                    since: a.requestedAt.slice(0, 10),
                  })}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={t("statutory")}>
          {d.statutoryWatch.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noStatutory")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.statutoryWatch.map((w) => (
                <li
                  key={`${w.caseId}-${w.what}`}
                  className={w.daysLeft < 0 ? "text-status-warn-fg" : undefined}
                >
                  <Link
                    href={`/jml/cases/${w.caseId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {w.caseRef}
                  </Link>{" "}
                  {t("watchLine", {
                    name: w.name,
                    what: w.what === "VISA_CANCELLATION" ? t("visa") : w.what,
                    days: w.daysLeft,
                  })}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      <SectionCard title={t("reasons")}>
        {d.exitReasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noReasons")}</p>
        ) : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {d.exitReasons.map((r) => (
              <li key={r.level1} className="flex justify-between border-b border-border py-1">
                <span>{t(`level1.${r.level1}`)}</span>
                <span className="font-medium">{r.exits}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
