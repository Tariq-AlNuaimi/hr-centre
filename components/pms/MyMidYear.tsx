"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { KPI_LEVEL_FIELDS } from "./change-request-draft";

/**
 * §6 from the employee's own side — the screen they had none of.
 *
 * Before UAT Scenario C a mid-year change went manager → HR and the employee
 * learned about it when their year-end assessment was measured against goals
 * they had never seen move. This screen is where they see it and say so.
 *
 * **There is no reject button, and that is deliberate.** It mirrors §5.1's
 * goal-setting sign-off: the disagreement is settled in the offline
 * conversation, and the system records only whether the employee has seen the
 * change. What makes that more than a formality is the deadline — a request
 * never acknowledged locks at the mid-year deadline and the KPI stays as it
 * was. Declining to click IS the refusal, and it is the stronger one.
 *
 * The five descriptors are shown in full rather than summarised. §5.2 makes
 * them the definition of what each rating MEANS, so an employee asked whether a
 * change is acceptable cannot answer from a weight alone.
 */

/** The same field list the manager's composer and HR's review panel use. */
const FIELDS = [
  { field: "description" as const },
  { field: "weightage" as const },
  ...KPI_LEVEL_FIELDS.map(({ field }) => ({ field })),
];

interface MyKpi {
  id: string;
  description: string;
  weightage: string;
  descriptorOutstanding: string;
  descriptorExcellent: string;
  descriptorTarget: string;
  descriptorAlmostAchieved: string;
  descriptorUnsatisfactory: string;
}

interface MyEdit {
  kpiId: string;
  description: string | null;
  weightage: string | null;
  descriptorOutstanding: string | null;
  descriptorExcellent: string | null;
  descriptorTarget: string | null;
  descriptorAlmostAchieved: string | null;
  descriptorUnsatisfactory: string | null;
}

interface MyRequest {
  id: string;
  status: string;
  effectiveStatus: string;
  rationale: string;
  requestedAt: string;
  acknowledgedAt: string | null;
  acknowledgmentOverridden: boolean;
  overrideReason: string | null;
  decisionReason: string | null;
  requestedByEmployee: { id: string; name: string } | null;
  decidedByEmployee: { id: string; name: string } | null;
  edits: MyEdit[];
}

interface MyMidYearResponse {
  cycle: { id: string; year: number } | null;
  participant: { id: string; goalsApprovedAt: string | null } | null;
  kpis: MyKpi[];
  changeRequests: MyRequest[];
}

/** One row of the old → new comparison. The arrow is the whole point. */
function FieldDiff({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="space-y-1 text-sm">
        <p className="text-muted-foreground line-through">{before}</p>
        <p className="font-medium text-foreground">{after}</p>
      </dd>
    </div>
  );
}

function AcknowledgmentBadge({ request }: { request: MyRequest }) {
  const t = useTranslations("pms.myMidYear");
  if (request.acknowledgmentOverridden) {
    return <Badge variant="warning">{t("ackOverridden")}</Badge>;
  }
  if (request.acknowledgedAt) {
    return (
      <Badge variant="success">
        {t("ackOn", { datetime: formatDateTime(request.acknowledgedAt) })}
      </Badge>
    );
  }
  if (request.effectiveStatus === "NOT_ACKNOWLEDGED") {
    return <Badge variant="danger">{t("ackMissed")}</Badge>;
  }
  return <Badge variant="outline">{t("ackAwaiting")}</Badge>;
}

export function MyMidYear({ hideWhenAbsent = false }: { hideWhenAbsent?: boolean } = {}) {
  const t = useTranslations("pms.myMidYear");
  const queryClient = useQueryClient();

  const mine = useQuery({
    queryKey: ["pms", "mid-year", "me"],
    queryFn: () => apiClient.get<MyMidYearResponse>("/api/mid-year/me"),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/kpi-change-requests/${id}/acknowledge`, {}),
    onSuccess: () => {
      toast.success(t("acknowledgedToast"));
      void queryClient.invalidateQueries({ queryKey: ["pms", "mid-year", "me"] });
    },
    onError: (error: Error) => toast.error(error.message || t("acknowledgeFailed")),
  });

  // `hideWhenAbsent` is for the MANAGER's page, where this sits above their
  // roster. A manager is usually also somebody's report, so the screen has to
  // carry both — but a manager who is NOT a participant (C-Level, §8.3) must not
  // be shown an empty "you have no KPIs" card on a page that is working fine.
  // On the employee's own page the same emptiness is the answer to their
  // question, so it stays visible there.
  if (mine.isLoading) return hideWhenAbsent ? null : <TableSkeleton rows={4} />;

  if (mine.isError) {
    if (hideWhenAbsent) return null;
    return (
      <SectionCard title={t("title")}>
        <EmptyState
          description={t("loadFailed")}
          actionLabel={t("retry")}
          onAction={() => void mine.refetch()}
        />
      </SectionCard>
    );
  }

  const data = mine.data;
  if (!data?.cycle || !data.participant) {
    if (hideWhenAbsent) return null;
    return (
      <SectionCard title={t("title")} subtitle={t("subtitle")}>
        <EmptyState description={t("noCycle")} />
      </SectionCard>
    );
  }

  // A manager with nothing of their own pending sees their roster, not a
  // duplicate of the KPI set they can already reach from their scorecard.
  if (hideWhenAbsent && data.changeRequests.length === 0) return null;

  const kpiById = new Map(data.kpis.map((k) => [k.id, k]));
  const pending = data.changeRequests.find((r) => r.effectiveStatus === "PENDING");
  // §6.3 — everything that is not the live question is history, including a
  // request that expired unacknowledged. It stays visible: the record of what
  // was asked is the point, not only the record of what was agreed.
  const history = data.changeRequests.filter((r) => r.id !== pending?.id);

  return (
    <div className="space-y-6">
      {/* --- the pending request, first: it is the only thing asking for an act --- */}
      {pending ? (
        <SectionCard
          title={pending.acknowledgedAt ? t("pendingAcknowledgedTitle") : t("pendingTitle")}
          subtitle={t("requestedBy", {
            name: pending.requestedByEmployee?.name ?? t("unknownRequester"),
            datetime: formatDateTime(pending.requestedAt),
          })}
        >
          <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
            {pending.rationale}
          </p>

          <div className="space-y-4">
            {pending.edits.map((edit) => {
              const live = kpiById.get(edit.kpiId);
              const moved = FIELDS.filter(({ field }) => edit[field] !== null);
              return (
                <div key={edit.kpiId} className="rounded-md border border-border p-4">
                  <p className="text-sm font-medium text-foreground">
                    {live?.description ?? t("kpiGone")}
                  </p>
                  <dl className="mt-3 space-y-3">
                    {moved.map(({ field }) => {
                      // The weight carries its unit on BOTH sides. Without it
                      // the diff read "40 → 30" while the card below said
                      // "40% of the set" — the same number in two languages on
                      // one screen, which is how a reader starts checking.
                      const unit = field === "weightage" ? "%" : "";
                      return (
                        <FieldDiff
                          key={field}
                          label={t(`field.${field}`)}
                          before={live ? `${String(live[field])}${unit}` : t("unknownBefore")}
                          after={`${String(edit[field])}${unit}`}
                        />
                      );
                    })}
                  </dl>
                </div>
              );
            })}
          </div>

          {/* Once acknowledged the request is still PENDING — for HR, not for
              the employee. Leaving the button up would offer an act already
              taken, which the API answers with a 409: a dead control that
              teaches people the screen is not tracking them. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {pending.acknowledgedAt ? (
              <>
                <AcknowledgmentBadge request={pending} />
                <p className="text-xs text-muted-foreground">{t("awaitingHrHelp")}</p>
              </>
            ) : (
              <>
                <Button
                  onClick={() => acknowledge.mutate(pending.id)}
                  disabled={acknowledge.isPending}
                >
                  {acknowledge.isPending ? t("acknowledging") : t("acknowledge")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("acknowledgeHelp")}</p>
              </>
            )}
          </div>
        </SectionCard>
      ) : null}

      {/* --- the locked set as it stands today --- */}
      <SectionCard title={t("currentTitle")} subtitle={t("currentSubtitle")}>
        {data.kpis.length === 0 ? (
          <EmptyState description={t("noKpis")} />
        ) : (
          <div className="space-y-4">
            {data.kpis.map((kpi) => (
              <div key={kpi.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{kpi.description}</p>
                  <Badge variant="outline">{t("weightOf", { weight: kpi.weightage })}</Badge>
                </div>
                {/* §5.2 — all five, because they are what a rating MEANS. */}
                <dl className="mt-3 space-y-2">
                  {KPI_LEVEL_FIELDS.map(({ field }) => (
                    <div key={field} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                      <dt className="text-xs font-medium text-muted-foreground">
                        {t(`field.${field}`)}
                      </dt>
                      <dd className="text-sm text-foreground">{String(kpi[field])}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* --- §6.3's history, with who agreed to what --- */}
      <SectionCard title={t("historyTitle")} subtitle={t("historySubtitle")}>
        {history.length === 0 ? (
          <EmptyState description={t("noHistory")} />
        ) : (
          <ul className="space-y-3">
            {history.map((row) => (
              <li key={row.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      row.effectiveStatus === "APPROVED"
                        ? "success"
                        : row.effectiveStatus === "REJECTED"
                          ? "danger"
                          : "outline"
                    }
                  >
                    {t(`status.${row.effectiveStatus}`)}
                  </Badge>
                  <AcknowledgmentBadge request={row} />
                  <span className="text-xs text-muted-foreground">
                    {t("requestedOn", { datetime: formatDateTime(row.requestedAt) })}
                  </span>
                </div>
                <p className="mt-2 text-sm text-foreground">{row.rationale}</p>
                {row.decisionReason ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("decisionReason", {
                      name: row.decidedByEmployee?.name ?? t("unknownDecider"),
                      reason: row.decisionReason,
                    })}
                  </p>
                ) : null}
                {/* §6.2 — an override is named, with its reason, on the record
                    the employee can see. A change made without their agreement
                    that they cannot later point to is the thing this flow
                    exists to prevent. */}
                {row.acknowledgmentOverridden && row.overrideReason ? (
                  <p className="mt-2 rounded-md border border-warning-emphasis/30 bg-warning/10 p-2 text-sm text-foreground">
                    {t("overrideReason", { reason: row.overrideReason })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
