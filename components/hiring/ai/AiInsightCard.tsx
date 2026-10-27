"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { qs, useHiringMutation, useHiringQuery } from "../ui/api";
import { Notice, QueryState } from "../ui/states";
import { InsightBody } from "./InsightBody";
import { useAiStatus, type InsightView } from "./useAi";

type Kind = "jd" | "fit" | "transcript";

/**
 * One AI insight on a record (Interview Hub `AiInsightPanel`): the latest run,
 * a button to run it again, and the honest states — AI not set up, switched
 * off, hidden by the panel mode, never run. Advisory: a person decides.
 */
export function AiInsightCard({
  kind,
  entityId,
  canRun,
  transcript,
}: {
  kind: Kind;
  entityId: string;
  canRun: boolean;
  transcript?: string;
}) {
  const t = useTranslations("hiring.ai");
  const { ready, status } = useAiStatus();
  const q = useHiringQuery<{ insight: InsightView | null; hidden: boolean }>(
    `/api/hiring/ai/insight${qs({ kind, entityId })}`,
  );
  const run = useHiringMutation<object>("POST", "/api/hiring/ai/insight", { success: t("done") });
  const insight = q.data?.insight ?? null;
  return (
    <SectionCard
      title={t(`title.${kind}`)}
      subtitle={t("advisory")}
      actions={
        canRun ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || run.isPending}
            onClick={() => run.mutate({ kind, entityId, ...(transcript ? { transcript } : {}) })}
          >
            <Sparkles className="h-4 w-4" />
            {run.isPending ? t("running") : insight ? t("rerun") : t("run")}
          </Button>
        ) : null
      }
    >
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        <div className="space-y-3">
          {canRun && status && !status.configured ? <Notice>{t("notConfigured")}</Notice> : null}
          {canRun && status?.switchedOff ? (
            <Notice tone="warning">{t("switchedOff")}</Notice>
          ) : null}
          {q.data?.hidden ? (
            <p className="text-sm text-muted-foreground">{t("hidden")}</p>
          ) : insight ? (
            <>
              <InsightBody json={insight.json} text={insight.text} />
              <p className="text-xs text-muted-foreground">
                {t("meta", { model: insight.model ?? "—", date: formatDate(insight.createdAt) })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(`empty.${kind}`)}</p>
          )}
        </div>
      </QueryState>
    </SectionCard>
  );
}
