"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, Circle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatDay } from "@/lib/format";

type Overview = {
  cycle: { id: string; year: number; status: "DRAFT" | "OPEN" | "CLOSED" };
  participants: number;
  truncated: boolean;
  stages: Array<{
    kind: "GOAL_SETTING" | "MID_YEAR" | "YEAR_END";
    opensAt: string;
    deadline: string;
    graceDays: number;
    state: "NOT_YET_OPEN" | "OPEN" | "LOCKED";
    completion: { done: number; total: number; percent: number } | null;
    late: number;
  }>;
  setup: Array<{ key: "stages" | "enrolled" | "scores" | "calibration"; done: boolean }>;
};

const STATE_TONE = { NOT_YET_OPEN: "default", OPEN: "success", LOCKED: "warning" } as const;
const SETUP_HREF = {
  stages: "/admin/cycles",
  enrolled: "/admin/cycles",
  scores: "/admin/strategy-scores",
  calibration: "/calibration",
} as const;

/**
 * A cycle's console (UX review perf-jml P1-8; Lattice's progress tab): the
 * three stages as a timeline with completion and late counts, "Remind late"
 * per stage once its deadline has passed, and a setup checklist. HR only —
 * the API answers 403 to anyone else and the screen says so.
 */
export function CycleConsole({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.cycleConsole");
  const tStage = useTranslations("pms.cycles");
  const { success, error } = useNotify();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["pms", "cycle-overview", cycleId],
    queryFn: () => apiClient.get<Overview>(`/api/cycles/${cycleId}/overview`),
    retry: false,
  });

  async function remind(stageKind: string) {
    try {
      const r = await apiClient.post<{ reminded: number }>(`/api/cycles/${cycleId}/remind`, {
        stageKind,
      });
      success(t("reminded", { count: r.reminded }));
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("remindFailed"));
    }
  }

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data)
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <SectionCard title={t("loadFailed")}>
          <EmptyState description={t("loadFailedHelp")} />
        </SectionCard>
      </div>
    );
  const { cycle, stages, setup, participants, truncated } = q.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("heading", { year: cycle.year })}
        subtitle={t("subtitle", { count: participants })}
        actions={<Badge variant="outline">{t(`status.${cycle.status}`)}</Badge>}
      />
      {truncated ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("truncated")}
        </p>
      ) : null}

      <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {stages.map((s) => (
          <li key={s.kind} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-foreground">
                {tStage(`stage.${s.kind}`)}
              </h3>
              <Badge variant={STATE_TONE[s.state]}>{t(`state.${s.state}`)}</Badge>
            </div>
            <p className="mt-1 mb-3 text-xs text-muted-foreground">
              {t("window", {
                opens: formatDay(s.opensAt),
                deadline: formatDay(s.deadline),
                grace: s.graceDays,
              })}
            </p>
            {s.completion ? (
              <>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-2xl font-semibold tabular-nums">
                    {s.completion.percent}%
                  </span>
                  <span className="text-muted-foreground">
                    {t("done", { done: s.completion.done, total: s.completion.total })}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-1.5 rounded-full bg-primary"
                    style={{ width: `${s.completion.percent}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {s.late > 0 ? (
                    <Link
                      href="/reports"
                      className="text-sm font-medium text-destructive-emphasis underline-offset-4 hover:underline"
                    >
                      {t("late", { count: s.late })}
                    </Link>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t("noneLate")}</span>
                  )}
                  {s.late > 0 && cycle.status === "OPEN" ? (
                    <Button size="sm" variant="outline" onClick={() => void remind(s.kind)}>
                      {t("remind")}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">{t("noTally")}</p>
            )}
          </li>
        ))}
      </ol>

      <SectionCard title={t("setupTitle")} subtitle={t("setupNote")}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {setup.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              {item.done ? (
                <Check aria-hidden className="h-4 w-4 text-primary" />
              ) : (
                <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
                {t(`setup.${item.key}`)}
              </span>
              <span className="sr-only">{item.done ? t("setupDone") : t("setupTodo")}</span>
              {!item.done ? (
                <Link
                  href={SETUP_HREF[item.key]}
                  className="text-primary-emphasis underline-offset-4 hover:underline"
                >
                  {t("setupGo")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
