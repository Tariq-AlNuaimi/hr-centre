"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * §8's score calculation — the step §10.7 puts between "assessments completed &
 * signed" and the calibration gate.
 *
 * ## Why this component exists
 *
 * `POST /api/scores` was reachable by nothing. Not a screen, not a cron, not a
 * server action — the route was complete, tested and unreachable, so an HR
 * Super Admin could key every input and then had no way to produce a single
 * score. Calibration reported "no raw score" and publishing refused, both
 * correctly, and neither said what to do about it because the thing to do had
 * no button.
 *
 * ## The skipped list is the feature, not the error case
 *
 * §10.7 will not start calibration until EVERY participant has a raw score, so
 * "who could not be scored, and why" is the worklist HR has to clear. It is
 * rendered as the run's main result rather than tucked into a toast — a run
 * that scored 30 of 37 is not a failure and must not read like one, but the
 * seven names are the next piece of work.
 *
 * ## Re-running is safe, and says so
 *
 * §10.1 — a re-run writes a NEW `ScoreRun` and never touches an existing raw
 * score, so calibration already applied survives. That is worth stating on the
 * screen, because "recalculate" is exactly the button an operator hesitates
 * over once they have spent an afternoon moving bands.
 */

interface ScoreRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  scoredCount: number;
  skippedCount: number;
  startedByEmployee: { id: string; name: string } | null;
}

interface ScoreRunsResponse {
  runs: ScoreRunRow[];
  participantCount: number;
  latestRunId: string | null;
}

interface ScoreRunResult {
  run: { id: string; scoredCount: number; skippedCount: number };
  skipped: { employeeId: string; reason: string }[];
}

export function ScoreRunPanel({ cycleId }: { cycleId: string }) {
  const t = useTranslations("pms.scoreRun");
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ScoreRunResult | null>(null);

  const state = useQuery({
    queryKey: ["pms", "scoreRuns", cycleId],
    queryFn: () => apiClient.get<ScoreRunsResponse>(`/api/scores?cycleId=${cycleId}`),
  });

  const mutation = useMutation({
    mutationFn: () => apiClient.post<ScoreRunResult>("/api/scores", { cycleId }),
    onSuccess: (result) => {
      setLastResult(result);
      toast.success(t("doneToast", { count: result.run.scoredCount }));
      void queryClient.invalidateQueries({ queryKey: ["pms", "scoreRuns", cycleId] });
      // The two screens downstream of a run: calibration reads the new scores,
      // and the publish gate's readiness turns on them.
      void queryClient.invalidateQueries({ queryKey: ["pms", "calibration", cycleId] });
      void queryClient.invalidateQueries({ queryKey: ["pms", "publish", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const latest = state.data?.runs[0] ?? null;
  const participantCount = state.data?.participantCount ?? 0;
  const skipped = lastResult?.skipped ?? [];

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? t("working") : latest ? t("rerunAction") : t("runAction")}
        </Button>
      }
    >
      <div className="space-y-4">
        {state.isError && <EmptyState description={t("loadFailed")} />}

        {!state.isError && !latest && (
          <EmptyState description={t("neverRun", { count: participantCount })} />
        )}

        {latest && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">
              {t("scoredOf", { scored: latest.scoredCount, total: participantCount })}
            </Badge>
            {latest.skippedCount > 0 && (
              <Badge variant="outline">{t("skippedCount", { count: latest.skippedCount })}</Badge>
            )}
            <span className="text-muted-foreground">
              {t("lastRun", {
                who: latest.startedByEmployee?.name ?? t("unknownWho"),
                when: formatDateTime(latest.startedAt),
              })}
            </span>
          </div>
        )}

        {/* §10.7's worklist. Only from a run just performed: the route returns
            the reasons, and re-deriving them on read would be a second
            implementation of the scoring rules that could disagree with the
            one that produced the scores. */}
        {skipped.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("worklist", { count: skipped.length })}</p>
            <ul className="space-y-1">
              {skipped.map((row) => (
                <li key={row.employeeId} className="rounded-md border border-border p-2 text-sm">
                  {row.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("rerunSafe")}</p>
      </div>
    </SectionCard>
  );
}
