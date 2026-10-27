"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { Check, Field } from "../ui/fields";
import { QueryState } from "../ui/states";
import type { AiUsageView } from "./types";

/** Kill-switch, daily caps, timeout and prices, with today's use against them (hiring admin). */
export function AiLimitsCard() {
  const t = useTranslations("hiring.settings");
  const { me } = useHiringMe();
  const q = useHiringQuery<AiUsageView>(me?.isAdmin ? "/api/hiring/settings/ai/usage" : null);
  if (!me?.isAdmin) return null;
  return (
    <SectionCard title={t("limitsTitle")} subtitle={t("limitsHint")}>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={4}>
        {q.data ? <LimitsForm key={JSON.stringify(q.data.limits)} u={q.data} /> : null}
      </QueryState>
    </SectionCard>
  );
}

const FIELDS = [
  ["dailyTokenCap", "1"],
  ["dailySpendCap", "0.01"],
  ["timeoutMs", "1000"],
  ["pricePer1kIn", "0.0001"],
  ["pricePer1kOut", "0.0001"],
] as const;

function LimitsForm({ u }: { u: AiUsageView }) {
  const t = useTranslations("hiring.settings");
  const [f, setF] = useState(() =>
    Object.fromEntries(FIELDS.map(([k]) => [k, String(u.limits[k])])),
  );
  const [kill, setKill] = useState(u.limits.killSwitch);
  const save = useHiringMutation<object>("PUT", "/api/hiring/settings/ai/limits", {
    success: t("saved"),
  });
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {(
          [
            ["todayCalls", String(u.today.calls)],
            ["todayTokens", u.today.tokens.toLocaleString()],
            ["todaySpend", u.today.spend === null ? "—" : u.today.spend.toFixed(2)],
          ] as const
        ).map(([k, val]) => (
          <div key={k} className="rounded-md border border-border p-3">
            <dt className="text-xs text-muted-foreground">{t(k)}</dt>
            <dd className="text-h4 font-semibold">{val}</dd>
          </div>
        ))}
      </dl>
      <Check id="ai-kill" checked={kill} onChange={setKill}>
        {t("killSwitch")}
      </Check>
      <div className="grid gap-4 md:grid-cols-3">
        {FIELDS.map(([k, step]) => (
          <Field key={k} label={t(k)} htmlFor={`lim-${k}`} hint={t(`${k}Hint`)}>
            <Input
              id={`lim-${k}`}
              type="number"
              min={0}
              step={step}
              value={f[k]}
              onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <Button
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            killSwitch: kill,
            ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(f[k])])),
          })
        }
      >
        {t("save")}
      </Button>
      <div>
        <p className="mb-2 text-sm font-medium">{t("usageTitle", { days: u.days })}</p>
        {u.byFeature.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noUsage")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                {(["colFeature", "colCalls", "colTokens", "colLatency"] as const).map((k) => (
                  <th key={k} scope="col" className="py-1 text-start font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {u.byFeature.map((r) => (
                <tr key={r.feature} className="border-b border-border last:border-0">
                  <td className="py-1">{r.feature}</td>
                  <td className="py-1 font-mono">{r.calls}</td>
                  <td className="py-1 font-mono">{r.tokens.toLocaleString()}</td>
                  <td className="py-1 font-mono">{t("ms", { n: r.avgLatencyMs })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
