"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { EyeOff, FileEdit, Lightbulb, NotebookPen } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { hiringFetch, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { Textarea } from "../ui/fields";
import { Notice, QueryState } from "../ui/states";
import { initials, useRoundLabel } from "../interviews/bits";
import { whenLabel } from "../interviews/time";
import type { Brief, MyCard } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

/** `/hiring/panel/[id]/brief` (Interview Hub panel brief): facts only, the round's focus, questions, live notes. */
export function PanelBrief({ id }: { id: string }) {
  const t = useTranslations("hiring.panel");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const q = useHiringQuery<Brief>(`/api/hiring/panel/${id}/brief`);
  const b = q.data;
  useCrumb(id, b?.candidate.name);
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {b ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-5">
            <Avatar className="h-12 w-12" aria-hidden>
              <AvatarFallback>{initials(b.candidate.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-56 flex-1">
              <h1 className="text-xl font-semibold">{b.candidate.name}</h1>
              <p className="text-sm text-muted-foreground">
                {[
                  b.requisition.title,
                  roundLabel(b.interview.round, b.interview.roundOrdinal),
                  whenLabel(b.interview.scheduledDate),
                  b.interview.location,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button onClick={() => router.push(`/${locale}/hiring/panel/${id}/score`)}>
              <FileEdit className="h-4 w-4" />
              {b.alreadySubmitted ? t("viewScorecard") : t("startScorecard")}
            </Button>
          </div>
          <Notice tone="warning" title={t("factsOnlyTitle")}>
            <span className="inline-flex gap-2">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("factsOnlyBody")}
            </span>
          </Notice>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Profile b={b} />
            <div className="space-y-4">
              <SectionCard title={t("focusTitle")} subtitle={t("focusHint")}>
                <div className="flex flex-wrap gap-1.5">
                  {b.competencies.length === 0 ? (
                    <span className="text-sm text-muted-foreground">{t("noCompetenciesSet")}</span>
                  ) : (
                    b.competencies.map((c) => (
                      <Badge key={c} variant="brand">
                        {c}
                      </Badge>
                    ))
                  )}
                </div>
              </SectionCard>
              <Questions b={b} />
            </div>
          </div>
          <LiveNotes id={id} />
        </div>
      ) : null}
    </QueryState>
  );
}

function Profile({ b }: { b: Brief }) {
  const t = useTranslations("hiring.panel");
  const c = b.candidate;
  return (
    <SectionCard title={t("summaryTitle")}>
      <div className="space-y-4 text-sm">
        {c.summary ? <p>{c.summary}</p> : <p className="text-muted-foreground">{t("noSummary")}</p>}
        {c.currentEmployer ? (
          <p className="text-muted-foreground">
            {t("currentlyAt", { employer: c.currentEmployer })}
          </p>
        ) : null}
        {c.experience.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("experience")}
            </h3>
            <ul className="space-y-3">
              {c.experience.map((e, i) => (
                <li key={i}>
                  <div className="font-semibold">
                    {e.title ?? "—"}
                    {e.company ? (
                      <span className="font-normal text-muted-foreground"> · {e.company}</span>
                    ) : null}
                  </div>
                  {e.period ? (
                    <div className="font-mono text-xs text-muted-foreground">{e.period}</div>
                  ) : null}
                  {e.description ? <p className="text-muted-foreground">{e.description}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.skills.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("skills")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {c.skills.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Questions({ b }: { b: Brief }) {
  const t = useTranslations("hiring.panel");
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4" aria-hidden />
          {t("questionsTitle")}
        </span>
      }
      actions={<Badge variant="info">{t("evidenceAid")}</Badge>}
      subtitle={t("questionsHint")}
    >
      {b.questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noQuestions")}</p>
      ) : (
        <ul className="space-y-2">
          {b.questions.map((qn) => (
            <li key={qn.id} className="rounded-md border border-border p-3 text-sm">
              <p>{qn.questionText}</p>
              {qn.competency ? (
                <Badge variant="outline" className="mt-2">
                  {qn.competency}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Private notes, autosaved to the panelist's own draft scorecard (never submitting it). */
function LiveNotes({ id }: { id: string }) {
  const t = useTranslations("hiring.panel");
  const card = useHiringQuery<MyCard | null>(`/api/hiring/panel/${id}/score`);
  const [notes, setNotes] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const submitted = card.data?.submitted === true;
  const value = notes ?? card.data?.notes ?? "";
  const onChange = (v: string) => {
    setNotes(v);
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      hiringFetch(`/api/hiring/panel/${id}/score`, {
        method: "POST",
        body: { notes: v, submit: false },
      })
        .then(() => setSave("saved"))
        .catch(() => setSave("error"));
    }, 1000);
  };
  const status = submitted ? t("notesSubmitted") : t(`notesState.${save}`);
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <NotebookPen className="h-4 w-4" aria-hidden />
          {t("notesTitle")}
        </span>
      }
      actions={
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {status}
        </span>
      }
      subtitle={t("notesHint")}
    >
      <Textarea
        aria-label={t("notesTitle")}
        rows={6}
        maxLength={5000}
        value={value}
        disabled={submitted || card.isLoading || Boolean(card.error)}
        placeholder={submitted ? t("notesSubmitted") : t("notesPlaceholder")}
        onChange={(e) => onChange(e.target.value)}
      />
    </SectionCard>
  );
}
