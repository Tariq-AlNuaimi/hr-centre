"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "@/components/shared/FormControls";
import { useJmlAction } from "../use-jml";

/**
 * P2-5 — the leaver's access cut-off and the per-system status summary that
 * heads the Access register.
 */

export type Cutoff = {
  at: string | null;
  isDefault: boolean;
  loginRevokedAt: string | null;
  timeZone: string;
};
export type DomainSummary = { domain: string; total: number; done: number; overdue: number };

/** "2027-05-12T17:00" in the organisation's zone, for the datetime-local input. */
function toLocalInput(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function AccessCutoff({
  caseId,
  cutoff,
  canManage,
}: {
  caseId: string;
  cutoff: Cutoff;
  canManage: boolean;
}) {
  const t = useTranslations("jml.register.cutoff");
  const { run, busy } = useJmlAction(t("failed"));
  const [value, setValue] = useState(cutoff.at ? toLocalInput(cutoff.at, cutoff.timeZone) : "");

  const save = (at: string | null) =>
    run(() => apiClient.put(`/api/jml/cases/${caseId}/access-cutoff`, { at }), t("saved")).then(
      Boolean,
    );

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
      <div className="space-y-0.5">
        <p className="m-0 font-medium">{t("title")}</p>
        <p className="m-0 text-muted-foreground">
          {cutoff.loginRevokedAt
            ? t("revoked", { when: formatAt(cutoff.loginRevokedAt, cutoff.timeZone) })
            : cutoff.at
              ? t(cutoff.isDefault ? "scheduledDefault" : "scheduled", {
                  when: formatAt(cutoff.at, cutoff.timeZone),
                  zone: cutoff.timeZone,
                })
              : t("noDate")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={cutoff.loginRevokedAt ? "success" : "outline"}>
          {cutoff.loginRevokedAt ? t("loginRevoked") : t("loginActive")}
        </Badge>
        {canManage && !cutoff.loginRevokedAt ? (
          <ActionDialog
            trigger={
              <Button size="sm" variant="outline">
                {t("change")}
              </Button>
            }
            title={t("changeTitle")}
            description={t("changeHelp", { zone: cutoff.timeZone })}
            confirmLabel={t("save")}
            busy={busy}
            disabled={!value}
            onConfirm={() => save(value)}
          >
            <Field id="cutoff-at" label={t("at")}>
              <Input
                id="cutoff-at"
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            {!cutoff.isDefault ? (
              <Button
                type="button"
                size="sm"
                variant="link"
                className="h-auto p-0"
                disabled={busy}
                onClick={() => void save(null)}
              >
                {t("useDefault")}
              </Button>
            ) : null}
          </ActionDialog>
        ) : null}
      </div>
    </div>
  );
}

/** Per access domain: done of total, and how many are overdue. */
export function AccessSummary({ rows }: { rows: DomainSummary[] }) {
  const t = useTranslations("jml.register.cutoff");
  const tv = useTranslations("jml.register.domain");
  if (rows.length === 0) return null;
  return (
    <ul className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("summary")}>
      {rows.map((r) => (
        <li key={r.domain} className="rounded-md border border-border p-2 text-sm">
          <p className="m-0 text-xs text-muted-foreground">{tv(r.domain)}</p>
          <p className="m-0 font-medium">{t("done", { done: r.done, total: r.total })}</p>
          {r.overdue > 0 ? (
            <p className="m-0 text-xs text-status-warn-fg">{t("overdue", { count: r.overdue })}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
