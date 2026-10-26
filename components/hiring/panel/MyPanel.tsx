"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarDays, CheckCircle2, EyeOff, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { useHiringQuery } from "../ui/api";
import { Notice, QueryState } from "../ui/states";
import { VoteBadge, initials, useRoundLabel } from "../interviews/bits";
import { timeOf } from "../interviews/time";
import type { PanelRow } from "./types";

/** `/hiring/panel` (Interview Hub `/panel`): my assigned interviews — prepare, score, compare. */
export function MyPanel() {
  const t = useTranslations("hiring.panel");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const q = useHiringQuery<{ upcoming: PanelRow[]; submitted: PanelRow[] }>("/api/hiring/panel");
  const go = (path: string) => router.push(`/${locale}/hiring/panel/${path}`);
  const upcoming = q.data?.upcoming ?? [];
  const submitted = q.data?.submitted ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Badge variant="info">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("panelistView")}
          </Badge>
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <Notice tone="info" title={t("independentTitle")}>
          <span className="inline-flex gap-2">
            <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("independentBody")}
          </span>
        </Notice>
        <section aria-labelledby="pn-up" className="space-y-2">
          <h2
            id="pn-up"
            className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t("upcoming")}
          </h2>
          {upcoming.length === 0 ? (
            <p className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              {t("emptyUpcoming")}
            </p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((iv) => (
                <li
                  key={iv.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-5 py-4"
                >
                  <div className="min-w-22 text-center">
                    <div className="text-xs font-semibold text-muted-foreground">
                      {formatDate(iv.scheduledDate)}
                    </div>
                    <div className="font-mono text-base font-bold">{timeOf(iv.scheduledDate)}</div>
                  </div>
                  <Avatar aria-hidden>
                    <AvatarFallback>{initials(iv.candidate.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-48 flex-1">
                    <div className="font-semibold">{iv.candidate.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {[iv.requisition.title, roundLabel(iv.round), iv.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="min-w-44">
                    <div className="mb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      {t("youAssess")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {iv.competencies.length ? (
                        iv.competencies.slice(0, 4).map((c) => (
                          <Badge key={c} variant="outline">
                            {c}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("noCompetencies")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => go(`${iv.id}/brief`)}>
                      <BookOpen className="h-4 w-4" />
                      {t("prepare")}
                    </Button>
                    <Button onClick={() => go(`${iv.id}/score`)}>{t("score")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <SectionCard title={t("submitted")} noBodyPadding>
          {submitted.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t("emptySubmitted")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {submitted.map((iv) => (
                <li key={iv.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <CheckCircle2 className="h-5 w-5 text-status-ok-fg" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{iv.candidate.name}</div>
                    <div className="text-sm text-muted-foreground">{`${iv.requisition.title} · ${roundLabel(iv.round)}`}</div>
                  </div>
                  <VoteBadge vote={iv.myVote} />
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                    {formatDate(iv.scheduledDate)}
                  </span>
                  <Button variant="link" onClick={() => go(`${iv.id}/compare`)}>
                    {t("viewCompare")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </QueryState>
    </div>
  );
}
