"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CheckCircle2, Star, XCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { FlowRail } from "../ui/flow-rail";
import { Notice, QueryState } from "../ui/states";
import { VoteBadge } from "../interviews/bits";
import { RejectFinalistDialog, SelectPreferredDialog } from "./ComparisonDialogs";
import type { Comparison, Finalist } from "./comparison-types";

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));

/**
 * `/hiring/requisitions/[id]/comparison` (Interview Hub `CandidateComparisonClient`):
 * the competency matrix across finalists, each panelist's verdict and comment,
 * and the decision — select the preferred candidate with a written note.
 */
export function ComparisonView({ id }: { id: string }) {
  const t = useTranslations("hiring.comparison");
  const router = useRouter();
  const locale = useLocale();
  const q = useHiringQuery<Comparison>(`/api/hiring/requisitions/${id}/comparison`);
  const [selecting, setSelecting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const v = q.data;
  useCrumb(id, v?.requisition.title);
  const finalists = v?.finalists ?? [];
  const preferred = finalists.find((f) => f.preferred) ?? null;
  const strongest =
    finalists.reduce<Finalist | null>(
      (best, f) =>
        f.weighted !== null && (best?.weighted == null || f.weighted > best.weighted) ? f : best,
      null,
    ) ??
    finalists[0] ??
    null;
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {v ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title")}
            subtitle={
              finalists.length
                ? t("subtitle", {
                    title: v.requisition.title,
                    finalists: finalists.length,
                    cards: v.coverage.expected,
                  })
                : v.requisition.title
            }
            actions={
              finalists.length ? (
                <>
                  <Button
                    variant="outline"
                    disabled={!finalists.some((f) => !f.preferred)}
                    onClick={() => setRejecting(true)}
                  >
                    <XCircle className="h-4 w-4" />
                    {t("rejectFinalist")}
                  </Button>
                  <Button disabled={preferred !== null} onClick={() => setSelecting(true)}>
                    <CheckCircle2 className="h-4 w-4" />
                    {preferred ? t("isPreferred", { name: preferred.name }) : t("selectPreferred")}
                  </Button>
                </>
              ) : null
            }
          />
          <FlowRail current={5} />
          {finalists.length === 0 ? (
            <EmptyState
              description={t("empty")}
              actionLabel={t("viewPipeline")}
              onAction={() => router.push(`/${locale}/hiring/requisitions/${id}/pipeline`)}
            />
          ) : (
            <>
              {preferred ? <PreferredNotice id={id} preferred={preferred} /> : null}
              <Matrix v={v} />
              {v.coverage.outstanding ? (
                <Notice tone="warning" title={t("outstandingTitle")}>
                  {t("outstandingBody", {
                    count: v.coverage.outstanding,
                    who: v.coverage.missing
                      .map((m) =>
                        t("missingWho", {
                          name: m.panelistName,
                          round: m.round,
                          candidate:
                            finalists.find((f) => f.candidateId === m.candidateId)?.name ?? "—",
                        }),
                      )
                      .join("; "),
                  })}
                </Notice>
              ) : null}
              <h2 className="text-base font-semibold">{t("feedbackTitle")}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {finalists.map((f) => (
                  <FeedbackCard key={f.candidateId} f={f} />
                ))}
              </div>
            </>
          )}
          {selecting ? (
            <SelectPreferredDialog
              id={id}
              v={v!}
              initial={strongest?.candidateId}
              onClose={() => setSelecting(false)}
            />
          ) : null}
          {rejecting ? (
            <RejectFinalistDialog id={id} v={v!} onClose={() => setRejecting(false)} />
          ) : null}
        </div>
      ) : null}
    </QueryState>
  );
}

function PreferredNotice({ id, preferred }: { id: string; preferred: Finalist }) {
  const t = useTranslations("hiring.comparison");
  const clear = useHiringMutation<{ action: "clear-preferred"; candidateId: string }>(
    "POST",
    `/api/hiring/requisitions/${id}/comparison`,
    { success: t("cleared") },
  );
  return (
    <Notice tone="success" title={t("preferredTitle", { name: preferred.name })}>
      <p>
        {t("preferredMeta", {
          date: preferred.preferredAt ? formatDate(preferred.preferredAt) : "—",
          by: preferred.preferredByName ?? "—",
        })}
        {" · "}
        {preferred.preferredOutstandingScorecards
          ? t("outstandingAtTime", { count: preferred.preferredOutstandingScorecards })
          : t("fullPanel")}
      </p>
      {preferred.preferredNote ? (
        <p className="mt-1 whitespace-pre-wrap">
          {t("decisionNote", { note: preferred.preferredNote })}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        disabled={clear.isPending}
        onClick={() =>
          clear.mutate({ action: "clear-preferred", candidateId: preferred.candidateId })
        }
      >
        {t("clearSelection")}
      </Button>
    </Notice>
  );
}

function Matrix({ v }: { v: Comparison }) {
  const t = useTranslations("hiring.comparison");
  return (
    <SectionCard
      title={t("matrixTitle")}
      actions={<span className="text-xs text-muted-foreground">{t("matrixHint")}</span>}
      noBodyPadding
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-start">
              <th scope="col" className="px-4 py-2 text-start font-semibold">
                {t("competency")}
              </th>
              {v.finalists.map((f) => (
                <th key={f.candidateId} scope="col" className="px-4 py-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {f.preferred ? (
                      <Star aria-label={t("preferred")} className="h-3.5 w-3.5" />
                    ) : null}
                    {f.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.requisition.competencies.map((c, i) => (
              <tr key={c} className="border-b border-border">
                <th scope="row" className="px-4 py-2 text-start font-normal">
                  {c}
                </th>
                {v.finalists.map((f) => {
                  const a = f.averages[i];
                  return (
                    <td
                      key={f.candidateId}
                      className="px-4 py-2 text-center font-mono"
                      title={a?.count ? t("averagedOver", { count: a.count }) : t("nobodyScored")}
                    >
                      {fmt(a?.mean ?? null)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-4 py-2 text-start font-semibold">
                {t("weighted")}
              </th>
              {v.finalists.map((f) => (
                <td key={f.candidateId} className="px-4 py-2 text-center font-mono font-bold">
                  {fmt(f.weighted)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-muted-foreground">{t("matrixNote")}</p>
    </SectionCard>
  );
}

function verdictLabel(
  t: ReturnType<typeof useTranslations>,
  tv: ReturnType<typeof useTranslations>,
  f: Finalist,
) {
  const v = f.verdict;
  if (v.total === 0) return t("verdictNone");
  if (v.unanimous)
    return v.total === 1
      ? tv(v.unanimous)
      : t("verdictUnanimous", { vote: tv(v.unanimous).toLowerCase() });
  if (v.majority)
    return t("verdictMajority", {
      vote: tv(v.majority).toLowerCase(),
      n: v.tally[v.majority],
      total: v.total,
    });
  return t("verdictSplit", { total: v.total });
}

function FeedbackCard({ f }: { f: Finalist }) {
  const t = useTranslations("hiring.comparison");
  const tv = useTranslations("hiring.vote");
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          {f.preferred ? <Star aria-label={t("preferred")} className="h-4 w-4" /> : null}
          {f.name}
        </span>
      }
      actions={
        <Badge
          variant={f.verdict.unanimous ? "success" : "default"}
          title={t("cardsIn", { n: f.coverage.submitted, total: f.coverage.expected })}
        >
          {verdictLabel(t, tv, f)}
        </Badge>
      }
    >
      {f.feedback.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noPanel")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {f.feedback.map((p) => (
            <li key={p.panelistId} className="flex gap-3 py-3">
              <Avatar className="h-8 w-8" aria-hidden>
                <AvatarFallback>{p.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{p.name}</span>
                  {p.vote ? (
                    <VoteBadge vote={p.vote} />
                  ) : (
                    <Badge variant="outline">{t("notSubmitted")}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.isHiringManager ? t("hiringManager") : t("panelist"),
                    p.rounds,
                    p.submittedCount && p.submittedCount < p.slotCount
                      ? t("partial", { n: p.submittedCount, total: p.slotCount })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.comment ? (
                  <p className="mt-2 text-sm whitespace-pre-wrap italic">
                    “{p.comment}”
                    <span className="text-xs not-italic text-muted-foreground">
                      {" "}
                      — {t(`source.${p.commentSource}`)}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {p.vote ? t("noComment") : t("waiting")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
