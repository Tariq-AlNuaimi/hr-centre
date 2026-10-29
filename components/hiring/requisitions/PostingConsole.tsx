"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { formatDate } from "@/lib/format";
import { CHANNELS_WITH_DETAIL, omaniPreferredForced } from "@/lib/hiring/posting-rules";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Check, Field } from "@/components/shared/FormControls";
import { Notice, QueryState } from "../ui/states";
import type { RequisitionDetail } from "./types";

/**
 * Step 4 — posting & sourcing (Interview Hub `PostingSourcingClient`, T06/T07).
 * Only the careers page is published BY this app; the other channels are a
 * person's record that they posted there. The salary band is never published.
 */
type Row = {
  channel: string;
  live: boolean;
  detail: string | null;
  omaniPreferred: boolean;
  postedAt: string | null;
  postedByName: string | null;
  withdrawnAt: string | null;
  applicants: number;
};
type Console = {
  gate: { ok: true } | { ok: false; reason: string };
  rows: Row[];
  stats: {
    liveCount: number;
    applicants: number;
    sourcedDirectly: number;
    referrals: number;
    referralsWithNamedReferrer: number;
    daysOpen: number | null;
  };
  sourced: {
    id: string;
    name: string;
    currentEmployer: string | null;
    source: string;
    agencyName: string | null;
  }[];
};

export function PostingConsole({ id }: { id: string }) {
  const t = useTranslations("hiring.posting");
  const req = useHiringQuery<RequisitionDetail>(`/api/hiring/requisitions/${id}`);
  const view = useHiringQuery<Console>(`/api/hiring/requisitions/${id}/postings`);
  const [dialog, setDialog] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [omani, setOmani] = useState(false);
  const path = `/api/hiring/requisitions/${id}/postings`;
  const post = useHiringMutation<object>("POST", path, {
    success: t("posted"),
    onSuccess: () => setDialog(null),
  });
  const withdraw = useHiringMutation<string>("DELETE", (channel) => `${path}?channel=${channel}`, {
    success: t("withdrawn"),
  });
  const v = view.data;
  return (
    <QueryState isLoading={req.isLoading || view.isLoading} error={req.error ?? view.error}>
      {v && req.data ? (
        <div className="space-y-4">
          <PageHeader title={t("title", { title: req.data.title })} subtitle={t("subtitle")} />
          {!v.gate.ok ? (
            <Notice tone="warning" title={t("gateTitle")}>
              {v.gate.reason}
            </Notice>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard title={t("live")} value={v.stats.liveCount} />
            <StatCard title={t("applicants")} value={v.stats.applicants} />
            <StatCard title={t("sourced")} value={v.stats.sourcedDirectly} />
            <StatCard
              title={t("referrals")}
              value={v.stats.referrals}
              hint={t("namedReferrers", { n: v.stats.referralsWithNamedReferrer })}
            />
            <StatCard title={t("daysOpen")} value={v.stats.daysOpen ?? "—"} />
          </div>
          <SectionCard title={t("channels")} subtitle={t("channelsHint")}>
            <ul className="divide-y divide-border">
              {v.rows.map((r) => (
                <li
                  key={r.channel}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-foreground">{t(`channel.${r.channel}.label`)}</p>
                    <p className="text-muted-foreground">
                      {r.detail || t(`channel.${r.channel}.blurb`)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.live
                        ? t("liveLine", {
                            date: r.postedAt ? formatDate(r.postedAt) : "",
                            by: r.postedByName ?? "—",
                            n: r.applicants,
                          })
                        : r.withdrawnAt
                          ? t("withdrawnLine", { date: formatDate(r.withdrawnAt) })
                          : t("notPosted")}
                      {r.omaniPreferred ? ` · ${t("omaniPreferred")}` : ""}
                    </p>
                  </div>
                  {r.live ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(r.channel)}
                    >
                      {t("withdraw")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!v.gate.ok}
                      onClick={() => {
                        setDialog(r.channel);
                        setDetail("");
                        setOmani(omaniPreferredForced(r.channel as never));
                      }}
                    >
                      {t("post")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title={t("headhunting")}>
            {v.sourced.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noSourced")}</p>
            ) : null}
            <ul className="space-y-1 text-sm">
              {v.sourced.map((c) => (
                <li key={c.id} className="text-foreground">
                  {c.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {c.currentEmployer ?? "—"} · {c.agencyName ?? c.source}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
          <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {dialog ? t("postTo", { channel: t(`channel.${dialog}.label`) }) : ""}
                </DialogTitle>
              </DialogHeader>
              {dialog ? (
                <div className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{t(`channel.${dialog}.target`)}</p>
                  <p className="text-muted-foreground">
                    {t("applicationsGoTo", { where: t(`channel.${dialog}.goesTo`) })}
                  </p>
                  {dialog !== "CAREERS_PAGE" ? (
                    <Notice tone="info">{t("recordingNotice")}</Notice>
                  ) : null}
                  {CHANNELS_WITH_DETAIL.includes(dialog as never) ? (
                    <Field label={t(`channel.${dialog}.detailLabel`)} htmlFor="post-detail">
                      <Input
                        id="post-detail"
                        maxLength={300}
                        value={detail}
                        onChange={(e) => setDetail(e.target.value)}
                      />
                    </Field>
                  ) : null}
                  <Check
                    id="post-omani"
                    checked={omani}
                    disabled={omaniPreferredForced(dialog as never)}
                    onChange={setOmani}
                  >
                    {t("omaniPreferredLabel")}
                  </Check>
                  <p className="text-xs text-muted-foreground">{t("bandInternal")}</p>
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  {t("cancel")}
                </Button>
                <Button
                  disabled={post.isPending}
                  onClick={() =>
                    post.mutate({
                      channel: dialog,
                      detail: detail || undefined,
                      omaniPreferred: omani,
                    })
                  }
                >
                  {t("confirmPost")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </QueryState>
  );
}
