"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useStatusLabels } from "@/components/hive/escalations/status-labels";
import { useNotify } from "@/hooks/use-notify";
import { apiClient } from "@/lib/api-client";
import { DEFAULT_TICKET_PREFIX, formatTicketId } from "@/lib/hive/ticket-id";
import { LABELLED_STATUSES, ticketPrefixSchema } from "@/lib/validations/hive/ticket-settings";

/**
 * Spec V2 §8.8 Settings (blueprint T5): the ticket ID prefix and the status
 * labels, plus a link to the answer email's own editor.
 *
 * The preview shows the ID the way every screen and email will show it, because
 * the one surprising consequence of this setting is that it renames EVERY
 * ticket, including ones already emailed — the intro says so before anyone saves.
 */

const ENDPOINT = "/api/hive/admin/ticket-settings";

interface Settings {
  ticketPrefix: string;
  statusLabels: Record<string, string>;
}

export default function HiveSettingsPage() {
  const t = useTranslations("hive.settings");
  const query = useQuery<Settings>({
    queryKey: ["hive", "ticket-settings"],
    queryFn: () => apiClient.get<Settings>(ENDPOINT),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("intro")} />
        <EmptyState description={t("loadFailed")} />
      </>
    );
  }
  if (!query.data) return <SettingsSkeleton />;
  // Remounted on every saved change, which seeds the fields with no effect.
  return (
    <SettingsForm
      key={JSON.stringify(query.data)}
      settings={query.data}
      refetch={() => void query.refetch()}
    />
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-16 w-full max-w-md rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

function SettingsForm({ settings, refetch }: { settings: Settings; refetch: () => void }) {
  const t = useTranslations("hive.settings");
  const locale = useLocale();
  const notify = useNotify();
  // The built-in labels, i.e. with no overrides: shown as placeholders.
  const defaults = useStatusLabels();
  const [prefix, setPrefix] = useState(settings.ticketPrefix);
  const [labels, setLabels] = useState<Record<string, string>>(settings.statusLabels);
  const [busy, setBusy] = useState(false);

  const customised =
    settings.ticketPrefix !== DEFAULT_TICKET_PREFIX ||
    Object.keys(settings.statusLabels).length > 0;
  // The same rule the server applies, checked as you type: a preview of an ID
  // the server will refuse is a promise the Save button cannot keep.
  const checked = ticketPrefixSchema.safeParse(prefix);

  async function put(body: Settings, done: string) {
    setBusy(true);
    try {
      await apiClient.put(ENDPOINT, body);
      refetch();
      notify.success(done);
    } catch (error) {
      // Verbatim: the prefix rule's message says what is allowed.
      notify.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <SectionCard title={t("prefixTitle")} subtitle={t("prefixHint")}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ticket-prefix">{t("prefixLabel")}</Label>
            <Input
              id="ticket-prefix"
              className="w-40 font-mono uppercase"
              value={prefix}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={checked.success ? undefined : true}
              aria-describedby="ticket-prefix-status"
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          {checked.success ? (
            <p id="ticket-prefix-status" className="m-0 pb-2 text-sm text-muted-foreground">
              {t("preview")}{" "}
              <span className="font-mono text-foreground">{formatTicketId(47, checked.data)}</span>
            </p>
          ) : (
            <p
              id="ticket-prefix-status"
              role="alert"
              className="m-0 pb-2 text-sm font-medium text-destructive-emphasis"
            >
              {checked.error.issues[0]?.message}
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t("labelsTitle")} subtitle={t("labelsHint")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {LABELLED_STATUSES.map((status) => (
            <div key={status} className="flex flex-col gap-2">
              <Label htmlFor={`label-${status}`}>{defaults[status]}</Label>
              <Input
                id={`label-${status}`}
                value={labels[status] ?? ""}
                placeholder={defaults[status]}
                maxLength={30}
                onChange={(e) => setLabels((l) => ({ ...l, [status]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void put({ ticketPrefix: prefix, statusLabels: labels }, t("saved"))}
          disabled={busy || !checked.success}
        >
          {busy ? t("saving") : t("save")}
        </Button>
        {customised ? (
          <ConfirmAction
            title={t("reset")}
            description={t("resetConfirm")}
            okText={t("reset")}
            okType="danger"
            onConfirm={() =>
              void put({ ticketPrefix: DEFAULT_TICKET_PREFIX, statusLabels: {} }, t("resetDone"))
            }
          >
            <Button variant="outline" disabled={busy}>
              {t("reset")}
            </Button>
          </ConfirmAction>
        ) : null}
        <Link
          href={`/${locale}/tickets/setup/email-template`}
          className="ms-auto text-sm text-primary-emphasis underline underline-offset-4"
        >
          {t("emailTemplateLink")}
        </Link>
      </div>
    </div>
  );
}
