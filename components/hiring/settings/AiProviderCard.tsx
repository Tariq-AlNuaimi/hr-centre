"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Check, Field } from "../ui/fields";
import { Notice, QueryState } from "../ui/states";
import type { AiProviderView } from "./types";

/** Provider, base URL, model and key. The key is write-only: the screen only learns whether one is set. */
export function AiProviderCard() {
  const t = useTranslations("hiring.settings");
  const q = useHiringQuery<AiProviderView>("/api/hiring/settings/ai");
  return (
    <SectionCard title={t("aiTitle")} subtitle={t("aiHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={4}>
        {q.data ? (
          <ProviderForm key={`${q.data.provider}${q.data.baseUrl}${q.data.model}`} v={q.data} />
        ) : null}
      </QueryState>
    </SectionCard>
  );
}

function ProviderForm({ v }: { v: AiProviderView }) {
  const t = useTranslations("hiring.settings");
  const [f, setF] = useState({
    provider: v.provider,
    baseUrl: v.baseUrl,
    model: v.model,
    apiKey: "",
    pdfVision: v.pdfVision,
  });
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useHiringMutation<object>("PUT", "/api/hiring/settings/ai", { success: t("saved") });
  const probe = useHiringMutation<undefined, { ok: boolean; message: string }>(
    "POST",
    "/api/hiring/settings/ai/test",
    {
      onSuccess: setTest,
    },
  );
  const ro = !v.canEdit;
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) =>
    setF((p) => ({ ...p, [k]: val }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={v.configured ? "success" : "outline"}>
          {v.configured ? t("connected") : t("notConnected")}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {v.keySet ? t(v.keySource === "env" ? "keyFromEnv" : "keyStored") : t("noKey")}
        </span>
      </div>
      {v.keyUnreadable ? <Notice tone="warning">{t("keyUnreadable")}</Notice> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("provider")} htmlFor="ai-provider">
          <NativeSelect
            id="ai-provider"
            disabled={ro}
            value={f.provider}
            onChange={(e) => set("provider", e.target.value as typeof f.provider)}
          >
            <option value="openai">{t("providerOpenai")}</option>
            <option value="anthropic">{t("providerAnthropic")}</option>
          </NativeSelect>
        </Field>
        <Field label={t("model")} htmlFor="ai-model" required>
          <Input
            id="ai-model"
            readOnly={ro}
            maxLength={200}
            value={f.model}
            onChange={(e) => set("model", e.target.value)}
          />
        </Field>
        <Field
          label={t("baseUrl")}
          htmlFor="ai-base"
          hint={t("baseUrlHint")}
          className="md:col-span-2"
        >
          <Input
            id="ai-base"
            readOnly={ro}
            type="url"
            maxLength={500}
            placeholder={t("baseUrlPlaceholder")}
            value={f.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
          />
        </Field>
        {ro ? null : (
          <Field
            label={t("apiKey")}
            htmlFor="ai-key"
            hint={t("apiKeyHint")}
            className="md:col-span-2"
          >
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              maxLength={400}
              value={f.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
            />
          </Field>
        )}
      </div>
      <Check
        id="ai-pdf"
        checked={f.pdfVision}
        disabled={ro}
        onChange={(val) => set("pdfVision", val)}
      >
        {t("pdfVision")}
      </Check>
      {test ? <Notice tone={test.ok ? "success" : "danger"}>{test.message}</Notice> : null}
      {ro ? (
        <p className="text-xs text-muted-foreground">{t("adminEdits")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={save.isPending || !f.model.trim()}
            onClick={() => save.mutate({ ...f, apiKey: f.apiKey || undefined })}
          >
            {t("save")}
          </Button>
          <Button
            variant="outline"
            disabled={probe.isPending || !v.configured}
            onClick={() => probe.mutate(undefined)}
          >
            <PlugZap className="h-4 w-4" />
            {probe.isPending ? t("testing") : t("test")}
          </Button>
          {v.keySource === "settings" ? (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => save.mutate({ ...f, apiKey: undefined, clearKey: true })}
            >
              {t("clearKey")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
