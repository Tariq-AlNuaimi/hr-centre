"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import type { HireVote } from "@/lib/hiring/scorecard-math";
import { Check } from "../ui/fields";
import {
  CompetencyScores,
  EvidenceFields,
  VotePicker,
  unscored,
  type ScorecardValue,
} from "../panel/ScorecardFields";

export type EvaluationValues = ScorecardValue & { submitted: boolean };

/** The scorecard body as HR records or corrects it (Interview Hub `EvaluationForm`). */
export function EvaluationForm({
  competencies,
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  competencies: string[];
  initial: EvaluationValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: EvaluationValues & { vote: HireVote }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("hiring.evaluations");
  const tp = useTranslations("hiring.panel");
  const [v, setV] = useState(initial);
  const missing = unscored(competencies, v.scores);
  const blocker = !v.vote
    ? tp("needVote")
    : v.submitted && missing.length
      ? tp("needScores", { count: missing.length })
      : null;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.vote && !blocker) onSubmit({ ...v, vote: v.vote });
      }}
    >
      <SectionCard title={tp("competencies")} noBodyPadding>
        <CompetencyScores
          competencies={competencies}
          value={v.scores}
          onChange={(scores) => setV({ ...v, scores })}
        />
      </SectionCard>
      <SectionCard title={tp("voteTitle")}>
        <VotePicker id="ev-vote" value={v.vote} onChange={(vote) => setV({ ...v, vote })} />
      </SectionCard>
      <SectionCard title={tp("evidence")}>
        <EvidenceFields value={v} onChange={(next) => setV({ ...next, submitted: v.submitted })} />
      </SectionCard>
      <Check
        id="ev-submitted"
        checked={v.submitted}
        onChange={(submitted) => setV({ ...v, submitted })}
      >
        {t("markSubmitted")}
        <span className="block text-xs text-muted-foreground">{t("markSubmittedHint")}</span>
      </Check>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {blocker ? <span className="text-xs text-muted-foreground">{blocker}</span> : null}
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={submitting || blocker !== null}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
