"use client";

import { useTranslations } from "next-intl";
import { HIRE_VOTES, type HireVote } from "@/lib/hiring/scorecard-math";
import { cn } from "@/lib/utils";
import { Field, Textarea } from "../ui/fields";
import { ScoreDots } from "../interviews/bits";
import type { AnchorMap } from "./types";

/**
 * The scorecard inputs shared by the panelist's scorecard and HR's
 * on-behalf evaluation: 1–5 per competency with BARS anchors, the hire vote,
 * and the written evidence (Interview Hub `Scorecard` + `AnchorHints` + vote).
 */
export type ScorecardValue = {
  scores: Record<string, number>;
  vote: HireVote | null;
  strengths: string;
  concerns: string;
  notes: string;
};

const LEVELS = ["1", "2", "3", "4", "5"] as const;

function Anchors({ anchors }: { anchors?: AnchorMap | null }) {
  const t = useTranslations("hiring.panel");
  const levels = LEVELS.filter((l) => anchors?.[l]?.trim());
  if (!anchors || levels.length === 0) return null;
  return (
    <dl aria-label={t("anchors")} className="mt-2 space-y-0.5 text-xs">
      {levels.map((l) => (
        <div key={l} className="flex gap-1.5">
          <dt className="font-semibold">{l}</dt>
          <dd className="text-muted-foreground">{anchors[l]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompetencyScores({
  competencies,
  anchors = {},
  value,
  onChange,
}: {
  competencies: string[];
  anchors?: Record<string, AnchorMap | null>;
  value: Record<string, number>;
  onChange: (s: Record<string, number>) => void;
}) {
  const t = useTranslations("hiring.panel");
  if (competencies.length === 0)
    return <p className="p-5 text-sm text-muted-foreground">{t("noCompetenciesCapture")}</p>;
  return (
    <ul className="divide-y divide-border">
      {competencies.map((c) => (
        <li key={c} className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1 font-semibold">{c}</span>
            <ScoreDots
              label={t("rateLabel", { competency: c })}
              value={value[c] ?? 0}
              onChange={(n) => onChange({ ...value, [c]: n })}
            />
          </div>
          <Anchors anchors={anchors[c]} />
        </li>
      ))}
    </ul>
  );
}

export function VotePicker({
  value,
  onChange,
  id,
}: {
  value: HireVote | null;
  onChange: (v: HireVote) => void;
  id: string;
}) {
  const t = useTranslations("hiring.vote");
  const tp = useTranslations("hiring.panel");
  return (
    <div
      role="radiogroup"
      aria-label={tp("voteTitle")}
      id={id}
      className="grid gap-2 sm:grid-cols-2"
    >
      {HIRE_VOTES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-start text-sm",
            value === v
              ? "border-primary bg-accent-subtle font-semibold"
              : "border-border hover:bg-muted",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "grid h-3.5 w-3.5 place-items-center rounded-full border-2",
              value === v ? "border-primary" : "border-input",
            )}
          >
            {value === v ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          </span>
          {t(v)}
        </button>
      ))}
    </div>
  );
}

export function EvidenceFields({
  value,
  onChange,
}: {
  value: ScorecardValue;
  onChange: (v: ScorecardValue) => void;
}) {
  const t = useTranslations("hiring.panel");
  return (
    <div className="space-y-3">
      <Field label={t("strengths")} htmlFor="sc-strengths">
        <Textarea
          id="sc-strengths"
          rows={3}
          maxLength={5000}
          placeholder={t("strengthsPlaceholder")}
          value={value.strengths}
          onChange={(e) => onChange({ ...value, strengths: e.target.value })}
        />
      </Field>
      <Field label={t("concerns")} htmlFor="sc-concerns">
        <Textarea
          id="sc-concerns"
          rows={3}
          maxLength={5000}
          placeholder={t("concernsPlaceholder")}
          value={value.concerns}
          onChange={(e) => onChange({ ...value, concerns: e.target.value })}
        />
      </Field>
      <Field label={t("notes")} htmlFor="sc-notes">
        <Textarea
          id="sc-notes"
          rows={2}
          maxLength={5000}
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

/** Competencies still without a score (the submit gate). */
export const unscored = (competencies: readonly string[], scores: Record<string, number>) =>
  competencies.filter((c) => !scores[c]);
