"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * §8.4 — the Corporate and Departmental scores.
 *
 * "The Strategy team measures corporate and departmental KPI achievement outside
 * this system." §4.1 gives them no system access, so HR keys the figures in —
 * which is what this screen is, and why it lives under /admin.
 *
 * ## Not-yet-keyed is not zero
 *
 * A missing score shows as "—" and counts toward the outstanding total at the
 * top. §8.1's scale starts at 1, so zero is not a score at all; rendering a
 * blank as 0.00 would look like a real (and catastrophic) figure, and §10.7's
 * gate would then pass on data nobody entered.
 *
 * ## One field per row, saved individually
 *
 * These arrive one at a time from the Strategy team, over days. A single "save
 * all" would make HR re-enter what they already keyed, or risk blanking a field
 * they had not touched.
 */

interface StrategyScoresResponse {
  cycleId: string;
  entities: Array<{
    id: string;
    code: string;
    name: string;
    score: string | null;
    updatedAt: string | null;
  }>;
  departments: Array<{
    id: string;
    name: string;
    entityId: string;
    score: string | null;
    updatedAt: string | null;
  }>;
  missing: { entities: number; departments: number };
}

export default function StrategyScoresPage() {
  const t = useTranslations("pms.strategyScores");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const scores = useQuery({
    queryKey: ["pms", "strategy-scores", cycleId],
    queryFn: () => apiClient.get<StrategyScoresResponse>(`/api/strategy-scores?cycleId=${cycleId}`),
    enabled: cycleId !== null,
  });

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  // §4.1 — both HR flavours run the cycle; `previewImport` is the same audience.
  if (!capabilities.orgWide) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  if (cycleList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  const data = scores.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      {scores.isLoading && <PageSkeleton />}

      {scores.isError && (
        <SectionCard title={t("loadFailed")}>
          <EmptyState
            description={t("loadFailedHelp")}
            actionLabel={t("retry")}
            onAction={() => void scores.refetch()}
          />
        </SectionCard>
      )}

      {data && cycleId && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              title={t("entitiesOutstanding")}
              value={data.missing.entities}
              hint={t("outstandingHint")}
            />
            <StatCard
              title={t("departmentsOutstanding")}
              value={data.missing.departments}
              hint={t("outstandingHint")}
            />
          </div>

          <SectionCard title={t("corporate")} subtitle={t("corporateHelp")}>
            <ul className="space-y-2">
              {data.entities.map((entity) => (
                <ScoreRow
                  key={entity.id}
                  cycleId={cycleId}
                  label={`${entity.name} (${entity.code})`}
                  score={entity.score}
                  payload={{ entityId: entity.id }}
                  rowId={entity.id}
                />
              ))}
            </ul>
          </SectionCard>

          <SectionCard title={t("departmental")} subtitle={t("departmentalHelp")}>
            {data.departments.length === 0 ? (
              <EmptyState description={t("noDepartments")} />
            ) : (
              <ul className="space-y-2">
                {data.departments.map((department) => (
                  <ScoreRow
                    key={department.id}
                    cycleId={cycleId}
                    label={department.name}
                    score={department.score}
                    payload={{ departmentId: department.id }}
                    rowId={department.id}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function ScoreRow({
  cycleId,
  label,
  score,
  payload,
  rowId,
}: {
  cycleId: string;
  label: string;
  score: string | null;
  payload: { entityId: string } | { departmentId: string };
  rowId: string;
}) {
  const t = useTranslations("pms.strategyScores");
  const queryClient = useQueryClient();
  const [value, setValue] = useState(score ?? "");

  const mutation = useMutation({
    mutationFn: () => apiClient.post("/api/strategy-scores", { cycleId, ...payload, score: value }),
    onSuccess: () => {
      toast.success(t("saved", { name: label }));
      void queryClient.invalidateQueries({ queryKey: ["pms", "strategy-scores", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <li className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="min-w-40 flex-1">
        <Label htmlFor={`score-${rowId}`}>{label}</Label>
        <p className="text-xs text-muted-foreground">
          {/* Not-yet-keyed said plainly, never rendered as a number. */}
          {score === null ? t("notKeyed") : t("current", { score })}
        </p>
      </div>
      <Input
        id={`score-${rowId}`}
        className="w-28"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="1.00–5.00"
        aria-describedby={`score-help-${rowId}`}
      />
      <span id={`score-help-${rowId}`} className="sr-only">
        {t("scaleHelp")}
      </span>
      <Button
        size="sm"
        disabled={value.trim() === "" || value === score || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t("saving") : t("saveAction")}
      </Button>
    </li>
  );
}
