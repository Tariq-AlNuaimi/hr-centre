"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// AI Role 2 narrative (UI-SPEC D.7 §6). When a narrative exists it renders, clearly
// labelled as an AI summary that restates the numbers (no recommendation). When it
// doesn't, a Generate button POSTs the narrative route; a 503 (LLM unconfigured)
// surfaces a calm "not configured" note — never a broken panel.
export function NarrativeBlock({
  resultId,
  narrative,
  narrativeModel,
}: {
  resultId: string;
  narrative: string | null;
  narrativeModel: string | null;
}) {
  const t = useTranslations("results");
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function generate() {
    setError(null);
    setUnavailable(false);
    setPending(true);
    try {
      const res = await fetch(`/api/results/${resultId}/narrative`, { method: "POST" });
      if (res.status === 503) {
        setUnavailable(true);
        setPending(false);
        return;
      }
      if (!res.ok) {
        setError(t("narrativeError"));
        setPending(false);
        return;
      }
      router.refresh();
      setPending(false);
    } catch {
      setError(t("narrativeError"));
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-4 text-accent" />
          {t("narrativeTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("narrativeCaption")}</p>
        {narrative ? (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {narrative}
            </p>
            {narrativeModel && (
              <p className="text-xs text-muted-foreground">
                {t("narrativeModel", { model: narrativeModel })}
              </p>
            )}
          </>
        ) : unavailable ? (
          <p className="text-sm text-muted-foreground">{t("narrativeUnavailable")}</p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button variant="outline" size="sm" onClick={generate} disabled={pending}>
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {pending ? t("narrativeGenerating") : t("narrativeGenerate")}
            </Button>
            {error && (
              <p role="alert" className="text-xs text-destructive-ink">
                {error}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
