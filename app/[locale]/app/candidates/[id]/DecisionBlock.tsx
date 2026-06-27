"use client";

import * as React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Loader2, Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DECISION_OUTCOMES, type DecisionOutcomeValue } from "@/lib/validations/result";

// Decision block (UI-SPEC D.7 §7). Advance / Hold / Decline + an optional note,
// POSTed to the decision route. The tool never decides — this captures the human
// call. Shows the current decision + who/when; honest async states (no green toast
// over a failure). DECISION_OUTCOMES is the client-safe tuple (no Prisma import).
export function DecisionBlock({
  resultId,
  decision,
  decisionNote,
  decidedByName,
  decidedAt,
}: {
  resultId: string;
  decision: DecisionOutcomeValue | null;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
}) {
  const t = useTranslations("results");
  const tDecisions = useTranslations("results.decisions");
  const format = useFormatter();
  const router = useRouter();
  const [choice, setChoice] = React.useState<DecisionOutcomeValue | null>(decision);
  const [note, setNote] = React.useState(decisionNote ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    if (!choice) return;
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const res = await fetch(`/api/results/${resultId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: choice, note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t("decisionError"));
        setPending(false);
        return;
      }
      setSaved(true);
      setPending(false);
      router.refresh();
    } catch {
      setError(t("decisionError"));
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("decisionTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{t("decisionSubtitle")}</p>

        <div role="radiogroup" aria-label={t("decisionTitle")} className="flex flex-wrap gap-2">
          {DECISION_OUTCOMES.map((d) => (
            <Button
              key={d}
              type="button"
              role="radio"
              aria-checked={choice === d}
              variant={choice === d ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setChoice(d);
                setSaved(false);
              }}
            >
              {tDecisions(d)}
            </Button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="decision-note" className="text-sm text-muted-foreground">
            {t("decisionNote")}
          </Label>
          <Textarea
            id="decision-note"
            value={note}
            maxLength={2000}
            placeholder={t("decisionNotePlaceholder")}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={!choice || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {pending ? t("decisionSaving") : t("decisionSave")}
          </Button>
          {saved && !error && (
            <span role="status" className="text-sm text-[var(--signal-pass-ink)]">
              {t("decisionSaved")}
            </span>
          )}
          {error && (
            <span role="alert" className="text-sm text-destructive-ink">
              {error}
            </span>
          )}
        </div>

        {decision && decidedByName && decidedAt ? (
          <p className="text-xs text-muted-foreground">
            {t("decidedBy", {
              decision: tDecisions(decision),
              who: decidedByName,
              when: format.dateTime(decidedAt, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }),
            })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("decisionNonePrompt")}</p>
        )}
      </CardContent>
    </Card>
  );
}
