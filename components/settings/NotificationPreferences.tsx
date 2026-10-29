"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { useNotify } from "@/hooks/use-notify";
import { ApiError, apiClient } from "@/lib/api-client";

type Pref = {
  kind: string;
  module: "performance" | "jml" | "hiring" | "tickets";
  mandatory: boolean;
  hasEmail: boolean;
  inApp: boolean;
  email: boolean;
};

const MODULES = ["performance", "jml", "hiring", "tickets"] as const;

/** Settings › Profile: which notices I get, per kind and channel (ADR-095). */
export function NotificationPreferences() {
  const t = useTranslations("settings.notificationPrefs");
  const tKind = useTranslations("pms.notifications.kind");
  const tModule = useTranslations("work.module");
  const q = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => apiClient.get<Pref[]>("/api/notifications/preferences"),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("note")}</p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <TableSkeleton rows={4} />
        ) : q.isError || !q.data ? (
          <p role="alert" className="text-sm text-destructive">
            {t("loadFailed")}
          </p>
        ) : (
          <PrefsForm
            key={JSON.stringify(q.data)}
            initial={q.data}
            kindLabel={(k) => tKind(k)}
            moduleLabel={(m) => tModule(m)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PrefsForm({
  initial,
  kindLabel,
  moduleLabel,
}: {
  initial: Pref[];
  kindLabel: (k: string) => string;
  moduleLabel: (m: string) => string;
}) {
  const t = useTranslations("settings.notificationPrefs");
  const client = useQueryClient();
  const { success, error } = useNotify();
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (kind: string, patch: Partial<Pref>) =>
    setPrefs(prefs.map((p) => (p.kind === kind ? { ...p, ...patch } : p)));
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        apiClient
          .put("/api/notifications/preferences", {
            preferences: prefs
              .filter((p) => !p.mandatory)
              .map((p) => ({ kind: p.kind, inApp: p.inApp, email: p.email })),
          })
          .then(async () => {
            success(t("saved"));
            await client.invalidateQueries({ queryKey: ["notification-preferences"] });
          })
          .catch((e: unknown) => error(e instanceof ApiError ? e.message : t("saveFailed")))
          .finally(() => setBusy(false));
      }}
    >
      {MODULES.map((m) => {
        const rows = prefs.filter((p) => p.module === m);
        if (rows.length === 0) return null;
        return (
          <fieldset key={m} className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{moduleLabel(m)}</legend>
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((p) => (
                <li
                  key={p.kind}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-sm text-foreground">
                    {kindLabel(p.kind)}
                    {p.mandatory ? (
                      <span className="ms-2 text-xs text-muted-foreground">{t("required")}</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.inApp}
                        disabled={p.mandatory}
                        onChange={(e) => set(p.kind, { inApp: e.target.checked })}
                      />
                      {t("inApp")}
                    </label>
                    {p.hasEmail ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={p.email}
                          disabled={p.mandatory}
                          onChange={(e) => set(p.kind, { email: e.target.checked })}
                        />
                        {t("email")}
                      </label>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
      <Button type="submit" disabled={busy}>
        {t("save")}
      </Button>
    </form>
  );
}
