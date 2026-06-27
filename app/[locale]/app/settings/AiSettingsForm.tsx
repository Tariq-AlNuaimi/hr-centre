"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Check, KeyRound, Server } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { AiSettingsView } from "@/lib/settings";

// Editable AI/scoring config (ADR-031, UI-SPEC D.10). The endpoint TOKENS are
// write-only: the input is always empty (the value is never sent back), a status line
// reports whether one is set + where from, and a DB-set token can be removed. URL/model
// inputs hold the DB OVERRIDE only — the env fallback is shown as a placeholder/hint —
// so saving never silently promotes an env value into a DB override. Honest async states.
export function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const t = useTranslations("settings");
  const router = useRouter();

  const [llmUrl, setLlmUrl] = React.useState(view.llm.url ?? "");
  const [llmModel, setLlmModel] = React.useState(view.llm.model ?? "");
  const [llmToken, setLlmToken] = React.useState("");
  const [removeLlmToken, setRemoveLlmToken] = React.useState(false);

  const [scoringUrl, setScoringUrl] = React.useState(view.scoring.url ?? "");
  const [scoringToken, setScoringToken] = React.useState("");
  const [removeScoringToken, setRemoveScoringToken] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    const body: Record<string, unknown> = {
      llmUrl,
      llmModel,
      scoringUrl,
    };
    if (removeLlmToken) body.clearLlmToken = true;
    else if (llmToken) body.llmToken = llmToken;
    if (removeScoringToken) body.clearScoringToken = true;
    else if (scoringToken) body.scoringToken = scoringToken;

    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? t("saveError"));
        setSaving(false);
        return;
      }
      setSaving(false);
      setSaved(true);
      setLlmToken("");
      setScoringToken("");
      setRemoveLlmToken(false);
      setRemoveScoringToken(false);
      router.refresh();
    } catch {
      setError(t("saveError"));
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* LLM */}
      <fieldset className="flex flex-col gap-4">
        <legend className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Server aria-hidden className="size-4 text-accent" />
          {t("llmSection")}
        </legend>
        <UrlField
          id="llm-url"
          label={t("endpointUrl")}
          value={llmUrl}
          onChange={setLlmUrl}
          placeholder={t("urlPlaceholderLlm")}
          envValue={view.llm.urlEnv}
          t={t}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-model">{t("model")}</Label>
          <Input
            id="llm-model"
            value={llmModel}
            placeholder={t("modelPlaceholderEnv", { value: view.llm.modelEnv })}
            onChange={(e) => setLlmModel(e.target.value)}
          />
        </div>
        <TokenField
          id="llm-token"
          label={t("token")}
          value={llmToken}
          onChange={setLlmToken}
          remove={removeLlmToken}
          onRemove={setRemoveLlmToken}
          set={view.llm.tokenSet}
          hint={view.llm.tokenHint}
          source={view.llm.tokenSource}
          t={t}
        />
      </fieldset>

      {/* Scoring */}
      <fieldset className="flex flex-col gap-4 border-t border-border pt-6">
        <legend className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound aria-hidden className="size-4 text-accent" />
          {t("scoringSection")}
        </legend>
        <UrlField
          id="scoring-url"
          label={t("endpointUrl")}
          value={scoringUrl}
          onChange={setScoringUrl}
          placeholder={t("urlPlaceholderScoring")}
          envValue={view.scoring.urlEnv}
          t={t}
        />
        <TokenField
          id="scoring-token"
          label={t("token")}
          value={scoringToken}
          onChange={setScoringToken}
          remove={removeScoringToken}
          onRemove={setRemoveScoringToken}
          set={view.scoring.tokenSet}
          hint={view.scoring.tokenHint}
          source={view.scoring.tokenSource}
          t={t}
        />
      </fieldset>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {saving ? t("saving") : t("save")}
        </Button>
        {saved && !error && (
          <span role="status" className="text-sm text-[var(--signal-pass-ink)]">
            {t("saved")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm text-[var(--signal-below-ink)]">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function UrlField({
  id,
  label,
  value,
  onChange,
  placeholder,
  envValue,
  t,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  envValue: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="url" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {/* Show the env fallback only when there's no DB override typed in. */}
      {!value && envValue && (
        <p className="text-xs text-muted-foreground">{t("urlUsingEnv", { value: envValue })}</p>
      )}
    </div>
  );
}

function TokenField({
  id,
  label,
  value,
  onChange,
  remove,
  onRemove,
  set,
  hint,
  source,
  t,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  remove: boolean;
  onRemove: (v: boolean) => void;
  set: boolean;
  hint: string | null;
  source: "db" | "env" | "none";
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={t("tokenPlaceholder")}
        disabled={remove}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-status`}
      />
      <p id={`${id}-status`} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {set ? (
          source === "db" ? (
            <Badge variant="pass">{t("tokenSetDb", { hint: hint ?? "" })}</Badge>
          ) : (
            <Badge variant="outline">{t("tokenSetEnv")}</Badge>
          )
        ) : (
          <span>{t("tokenNotSet")}</span>
        )}
        <span>{t("tokenWriteOnly")}</span>
      </p>
      {/* Only a DB-set token can be removed from here (env is platform-level). */}
      {set && source === "db" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={remove} onChange={(e) => onRemove(e.target.checked)} />
          {t("removeToken")}
        </label>
      )}
    </div>
  );
}
