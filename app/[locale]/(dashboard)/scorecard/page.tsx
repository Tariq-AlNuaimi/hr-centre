"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { Badge } from "@/components/ui/badge";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * §13.1 — the employee's own scorecard.
 *
 * "Shows only: final band and score (calibrated, but never labeled as such —
 * just 'their score') + consolidated 360 score and combined/summarized written
 * comments (not attributed to individual raters, protecting anonymity).
 *
 * The employee never sees: raw scores, component breakdown, any sign of
 * calibration, or mid-process work."
 *
 * The screen renders exactly what `/api/scorecard` returns and asks for nothing
 * more — the route's select is where "never sees" is enforced, and a screen that
 * fetched a wider payload and then hid fields would be one CSS mistake away from
 * defeating it.
 *
 * ## Before publication
 *
 * §13.2 — "Nothing shows to the employee while work is happening in the
 * background (no partial/shifting results)." The unpublished state is a plain,
 * calm sentence, not an error and not a spinner: nothing is wrong, and nothing
 * is being withheld from this person in particular.
 */

interface ScorecardResponse {
  published: boolean;
  cycleId: string;
  publishedAt?: string | null;
  score?: {
    employeeId: string;
    name: string;
    band: string;
    score: string;
    threeSixty: string | null;
    comments: string[];
  } | null;
}

export default function ScorecardPage() {
  const t = useTranslations("pms.scorecard");
  const tBand = useTranslations("pms.band");
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const scorecard = useQuery({
    queryKey: ["pms", "scorecard", cycleId],
    queryFn: () => apiClient.get<ScorecardResponse>(`/api/scorecard?cycleId=${cycleId}`),
    enabled: cycleId !== null,
  });

  if (cycles.isLoading) return <PageSkeleton />;

  const picker = (
    <CyclePicker
      cycles={cycleList}
      value={selectedCycleId ?? cycleId}
      onChange={setSelectedCycleId}
    />
  );

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

  const data = scorecard.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={picker} />

      {scorecard.isLoading && <PageSkeleton />}

      {scorecard.isError && (
        <SectionCard title={t("loadFailed")}>
          <EmptyState
            description={t("loadFailedHelp")}
            actionLabel={t("retry")}
            onAction={() => void scorecard.refetch()}
          />
        </SectionCard>
      )}

      {data && !data.published && (
        <SectionCard title={t("notPublished")}>
          <EmptyState description={t("notPublishedHelp")} />
        </SectionCard>
      )}

      {data?.published && !data.score && (
        <SectionCard title={t("noScore")}>
          <EmptyState description={t("noScoreHelp")} />
        </SectionCard>
      )}

      {data?.published && data.score && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* "just 'their score'" — no adjective, no comparison, no component. */}
            <StatCard title={t("yourScore")} value={data.score.score} hint={t("scoreHint")} />
            <StatCard
              title={t("yourBand")}
              value={<Badge>{tBand(data.score.band)}</Badge>}
              hint={t("bandHint")}
            />
            <StatCard
              title={t("threeSixty")}
              value={data.score.threeSixty ?? t("noThreeSixty")}
              hint={t("threeSixtyHint")}
            />
          </div>

          <SectionCard title={t("commentsTitle")} subtitle={t("commentsHelp")}>
            {data.score.comments.length === 0 ? (
              // Honest empty: no 360 comments is a real outcome, not a failure.
              <p className="text-sm text-muted-foreground">{t("noComments")}</p>
            ) : (
              <ul className="space-y-3">
                {data.score.comments.map((comment, index) => (
                  // The index is the only key available BY DESIGN — §13.1 says
                  // comments are "not attributed to individual raters", so no
                  // rater or response id reaches this component to key on.
                  <li
                    key={`comment-${index}`}
                    className="rounded-md border border-border bg-muted/40 p-3 text-sm"
                  >
                    {comment}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {data.publishedAt && (
            <p className="text-xs text-muted-foreground">
              {t("publishedAt", { when: formatDateTime(data.publishedAt) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
