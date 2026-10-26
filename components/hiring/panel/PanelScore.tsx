"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Bot, EyeOff, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { Notice, QueryState } from "../ui/states";
import { useRoundLabel } from "../interviews/bits";
import {
  CompetencyScores,
  EvidenceFields,
  VotePicker,
  unscored,
  type ScorecardValue,
} from "./ScorecardFields";
import type { Brief, MyCard } from "./types";

/** `/hiring/panel/[id]/score` (Interview Hub panel score): my independent scorecard. */
export function PanelScore({ id }: { id: string }) {
  const brief = useHiringQuery<Brief>(`/api/hiring/panel/${id}/brief`);
  const card = useHiringQuery<MyCard | null>(`/api/hiring/panel/${id}/score`);
  useCrumb(id, brief.data?.candidate.name);
  const loading = brief.isLoading || card.isLoading;
  return (
    <QueryState
      isLoading={loading}
      error={brief.error ?? card.error}
      onRetry={() => void Promise.all([brief.refetch(), card.refetch()])}
    >
      {brief.data && !loading ? (
        <ScoreForm id={id} b={brief.data} card={card.data ?? null} />
      ) : null}
    </QueryState>
  );
}

function ScoreForm({ id, b, card }: { id: string; b: Brief; card: MyCard | null }) {
  const t = useTranslations("hiring.panel");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const [v, setV] = useState<ScorecardValue>(() => ({
    scores: card?.scores ?? {},
    // A draft's stored vote is a placeholder until submitted, so it is not pre-selected.
    vote: card?.submitted ? card.vote : null,
    strengths: card?.strengths ?? "",
    concerns: card?.concerns ?? "",
    notes: card?.notes ?? "",
  }));
  const compare = () => router.push(`/${locale}/hiring/panel/${id}/compare`);
  const save = useHiringMutation<object>("POST", `/api/hiring/panel/${id}/score`, {
    success: t("draftSaved"),
  });
  const submit = useHiringMutation<object>("POST", `/api/hiring/panel/${id}/score`, {
    success: t("submittedToast"),
    onSuccess: compare,
  });
  if (card?.submitted) {
    return (
      <Notice tone="success" title={t("alreadySubmitted")}>
        <Button className="mt-2" onClick={compare}>
          {t("viewCompare")}
        </Button>
      </Notice>
    );
  }
  const missing = unscored(b.competencies, v.scores);
  const body = (s: boolean) => ({ ...v, vote: v.vote ?? undefined, submit: s });
  const busy = save.isPending || submit.isPending;
  const blocker = !v.vote
    ? t("needVote")
    : missing.length
      ? t("needScores", { count: missing.length })
      : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("scoreTitle", { name: b.candidate.name })}
        subtitle={t("scoreSubtitle", {
          round: roundLabel(b.interview.round, b.interview.roundOrdinal),
        })}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <SectionCard title={t("competencies")} noBodyPadding>
            <CompetencyScores
              competencies={b.competencies}
              anchors={b.anchors}
              value={v.scores}
              onChange={(scores) => setV({ ...v, scores })}
            />
          </SectionCard>
          <SectionCard title={t("voteTitle")} subtitle={t("voteHint")}>
            <VotePicker id="sc-vote" value={v.vote} onChange={(vote) => setV({ ...v, vote })} />
          </SectionCard>
          <SectionCard title={t("evidence")}>
            <EvidenceFields value={v} onChange={setV} />
          </SectionCard>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {blocker ? <span className="text-xs text-muted-foreground">{blocker}</span> : null}
            <Button variant="outline" disabled={busy} onClick={() => save.mutate(body(false))}>
              {t("saveDraft")}
            </Button>
            <ConfirmAction
              title={t("submitConfirmTitle")}
              description={t("submitConfirmBody")}
              okText={t("submitUnlock")}
              onConfirm={() => submit.mutate(body(true))}
            >
              <Button disabled={busy || blocker !== null}>{t("submitUnlock")}</Button>
            </ConfirmAction>
          </div>
        </div>
        <div className="space-y-4">
          {b.panelAiMode === "assisted" ? (
            <Button variant="outline" className="w-full" onClick={compare}>
              <Users className="h-4 w-4" />
              {t("openAssisted")}
            </Button>
          ) : (
            <>
              <Locked
                icon={<Bot className="h-4 w-4" />}
                title={t("aiLocked")}
                note={t("aiLockedNote")}
              />
              <Locked
                icon={<Users className="h-4 w-4" />}
                title={t("peersLocked")}
                note={t("peersLockedNote")}
              />
            </>
          )}
          <Notice tone="info">
            <span className="inline-flex gap-2">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {b.panelAiMode === "assisted" ? t("assistedNote") : t("blindNote")}
            </span>
          </Notice>
        </div>
      </div>
    </div>
  );
}

function Locked({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted p-4 text-center">
      <div className="mb-1.5 inline-flex items-center gap-1.5 text-muted-foreground" aria-hidden>
        {icon}
        <Lock className="h-3.5 w-3.5" />
      </div>
      <div className="mb-1 font-semibold text-muted-foreground">{title}</div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
