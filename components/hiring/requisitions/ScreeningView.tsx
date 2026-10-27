"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, ListChecks, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatMoney } from "@/lib/hiring/money";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { FlowRail } from "../ui/flow-rail";
import { ScoreChip, StageBadge } from "../ui/stage";
import { useCrumb } from "../ui/crumb";
import { QueryState } from "../ui/states";
import { FilterChips } from "../candidates/FilterChips";
import { AiScreenPanel } from "../ai/AiScreenPanel";

type Applicant = {
  id: string;
  name: string;
  stage: string;
  overallScore: number | null;
  aiNote: string | null;
  subLine: string | null;
  salaryExpectation: number | null;
  verdict: "SHORTLIST" | "OVER_BAND" | "REJECT" | null;
  why: string;
  withinBand: boolean;
};
type View = {
  requisition: { id: string; title: string };
  applicants: Applicant[];
  scoredCount: number;
  fitThreshold: number;
  canSeeExpectation: boolean;
};

const VERDICT_TONE = { SHORTLIST: "success", OVER_BAND: "warning", REJECT: "danger" } as const;

/**
 * CV screening (Interview Hub `/positions/[id]/screening`). Shortlist against
 * the JD and the band; select and shortlist, reject, or go to the assessment
 * queue. "Run AI screen" scores new applicants against the JD (advisory); with
 * AI not set up the panel says so and screening is by reading each CV.
 */
export function ScreeningView({ id }: { id: string }) {
  const t = useTranslations("hiring.screening");
  const router = useRouter();
  const locale = useLocale();
  const q = useHiringQuery<View>(`/api/hiring/requisitions/${id}/screening`);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<string | undefined>();
  const act = useHiringMutation<{ action: string; candidateIds: string[] }, { moved: number }>(
    "POST",
    `/api/hiring/requisitions/${id}/screening`,
    { success: t("actionDone"), onSuccess: () => setSelected([]) },
  );
  const v = q.data;
  useCrumb(id, v?.requisition.title);
  const rows = useMemo(() => {
    const all = v?.applicants ?? [];
    if (filter === "fit")
      return all.filter((r) => (r.overallScore ?? -1) >= (v?.fitThreshold ?? 0));
    if (filter === "band") return all.filter((r) => r.withinBand);
    return all;
  }, [v, filter]);
  const profile = (cid: string) => `/${locale}/hiring/candidates/${cid}`;

  const columns = [
    {
      title: t("colRank"),
      key: "rank",
      width: 48,
      render: (_: unknown, __: Applicant, i: number) => (
        <span className="text-muted-foreground">{i + 1}</span>
      ),
    },
    {
      title: t("colCandidate"),
      key: "name",
      render: (_: unknown, r: Applicant) => (
        <div className="flex flex-col">
          <Link href={profile(r.id)} className="font-medium text-foreground hover:underline">
            {r.name}
          </Link>
          {r.subLine ? <span className="text-xs text-muted-foreground">{r.subLine}</span> : null}
        </div>
      ),
    },
    {
      title: t("colFit"),
      key: "fit",
      width: 96,
      render: (_: unknown, r: Applicant) =>
        r.overallScore == null ? (
          <span className="rounded border border-dashed border-border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
            {t("notScored")}
          </span>
        ) : (
          <ScoreChip value={r.overallScore} />
        ),
    },
    ...(v?.canSeeExpectation
      ? [
          {
            title: t("colExpected"),
            key: "exp",
            align: "right" as const,
            render: (_: unknown, r: Applicant) =>
              r.salaryExpectation == null ? (
                <span className="text-muted-foreground">{t("notDeclared")}</span>
              ) : (
                formatMoney(r.salaryExpectation)
              ),
          },
        ]
      : []),
    {
      title: t("colVerdict"),
      key: "verdict",
      render: (_: unknown, r: Applicant) =>
        r.verdict ? (
          <Badge variant={VERDICT_TONE[r.verdict]}>{t(`verdict.${r.verdict}`)}</Badge>
        ) : (
          <span className="text-muted-foreground">{t("notScreened")}</span>
        ),
    },
    {
      title: t("colWhy"),
      key: "why",
      render: (_: unknown, r: Applicant) => <span title={r.aiNote ?? undefined}>{r.why}</span>,
    },
    {
      title: t("colStage"),
      key: "stage",
      render: (_: unknown, r: Applicant) => <StageBadge stage={r.stage} />,
    },
  ];

  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {v ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", {
              title: v.requisition.title,
              count: v.applicants.length,
              scored: v.scoredCount,
            })}
            actions={
              <Button
                disabled={v.applicants.length === 0}
                onClick={() => v.applicants[0] && router.push(profile(v.applicants[0].id))}
              >
                <ListChecks className="h-4 w-4" />
                {t("screenManually")}
              </Button>
            }
          />
          <FlowRail current={2} />
          <AiScreenPanel requisitionId={id} />
          <div className="space-y-1">
            <FilterChips
              label={t("filterLabel")}
              active={filter}
              onSelect={setFilter}
              options={[
                { value: undefined, label: t("filterAll") },
                { value: "fit", label: t("filterFit", { threshold: v.fitThreshold }) },
                { value: "band", label: t("filterBand") },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
          </div>
          {selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-accent-subtle px-4 py-2">
              <span className="text-sm font-semibold">
                {t("selected", { count: selected.length })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "shortlist", candidateIds: selected })}
              >
                <Check className="h-4 w-4" />
                {t("shortlist")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/${locale}/hiring/requisitions/${id}/assessment`)}
              >
                <FlaskConical className="h-4 w-4" />
                {t("assessmentQueue")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "reject", candidateIds: selected })}
              >
                <Ban className="h-4 w-4" />
                {t("reject")}
              </Button>
            </div>
          ) : null}
          <DataTable<Applicant>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (k) => setSelected(k.map(String)),
            }}
            emptyText={
              <p className="py-8 text-center text-sm text-muted-foreground">
                {filter ? t("emptyFiltered") : t("empty")}
              </p>
            }
          />
        </div>
      ) : null}
    </QueryState>
  );
}
