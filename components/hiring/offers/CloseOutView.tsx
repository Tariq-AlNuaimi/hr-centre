"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Copy, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { formatDate } from "@/lib/format";
import { qs, useHiringMutation, useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { FlowRail } from "../ui/flow-rail";
import { useRequisitionOptions } from "../ui/requisition-options";
import { Notice, QueryState } from "../ui/states";
import { FilterBar, FilterSelect } from "@/components/shared/FilterBar";

type Row = {
  id: string;
  name: string;
  initials: string;
  requisition: { id: string; title: string } | null;
  reached: string;
  reason: string | null;
  noticeStatus: "sent" | "held" | "ready";
  noticeSentAt: string | null;
  holdUntil: string | null;
  template: "interviewed" | "screening";
};
type Queue = { data: Row[]; total: number; counts: { ready: number; held: number; sent: number } };

const TONE = { sent: "success", held: "warning", ready: "info" } as const;

/**
 * `/hiring/close-out` — step 13 (Interview Hub `/close-out`). Everyone not
 * selected and where their notice stands. Nothing is emailed from HR Centre:
 * HR copies the routed notice, sends it from their own mailbox and marks it sent.
 */
export function CloseOutView() {
  const t = useTranslations("hiring.closeOut");
  const ts = useTranslations("hiring.stage");
  const locale = useLocale();
  const [requisitionId, setRequisitionId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { options: reqs } = useRequisitionOptions();
  useCrumb("close-out", t("title"));
  const q = useHiringQuery<Queue>(`/api/hiring/close-out${qs({ requisitionId, pageSize: 100 })}`);
  const mark = useHiringMutation<{ candidateIds: string[] }, { marked: number; skipped: number }>(
    "POST",
    "/api/hiring/close-out",
    {
      onSuccess: (r) => {
        toast.success(t("marked", { count: r.marked }));
        setSelected([]);
      },
    },
  );
  const rows = q.data?.data ?? [];
  const open = rows.filter((r) => r.noticeStatus !== "sent");
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button
            disabled={selected.length === 0 || mark.isPending}
            onClick={() => mark.mutate({ candidateIds: selected })}
          >
            <MailCheck className="h-4 w-4" />
            {selected.length ? t("markSelected", { count: selected.length }) : t("markSent")}
          </Button>
        }
      />
      <FlowRail current={6} />
      <Notice tone="info">{t("manualNotice")}</Notice>
      <FilterBar>
        <FilterSelect
          id="closeout-requisition"
          label={t("requisitionFilter")}
          allLabel={t("allRequisitions")}
          value={requisitionId}
          onChange={setRequisitionId}
          options={reqs.map((r) => ({ value: r.id, label: r.title }))}
        />
      </FilterBar>
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard title={t("ready")} value={q.data.counts.ready} />
            <StatCard title={t("held")} value={q.data.counts.held} />
            <StatCard title={t("sent")} value={q.data.counts.sent} />
          </div>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  aria-label={t("select", { name: r.name })}
                  disabled={r.noticeStatus === "sent"}
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <Avatar className="h-9 w-9" aria-hidden>
                  <AvatarFallback>{r.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-48 flex-1">
                  <Link
                    className="font-semibold hover:underline"
                    href={`/${locale}/hiring/candidates/${r.id}`}
                  >
                    {r.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[r.requisition?.title, t("reached", { stage: ts(r.reached) }), r.reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge
                  variant={TONE[r.noticeStatus]}
                  title={
                    r.holdUntil ? t("holdUntil", { date: formatDate(r.holdUntil) }) : undefined
                  }
                >
                  {r.noticeStatus === "sent" && r.noticeSentAt
                    ? t("sentOn", { date: formatDate(r.noticeSentAt) })
                    : r.noticeStatus === "held" && r.holdUntil
                      ? t("heldUntil", { date: formatDate(r.holdUntil) })
                      : t(`status.${r.noticeStatus}`)}
                </Badge>
                <CopyNotice row={r} />
              </li>
            ))}
          </ul>
        )}
        {open.length === 0 && rows.length ? (
          <p className="text-sm text-muted-foreground">{t("allDone")}</p>
        ) : null}
      </QueryState>
    </div>
  );
}

function CopyNotice({ row }: { row: Row }) {
  const t = useTranslations("hiring.closeOut");
  const role = row.requisition?.title ?? t("theRole");
  const copy = async () => {
    const text = `${t(`template.${row.template}.subject`, { role })}\n\n${t(`template.${row.template}.body`, { name: row.name, role })}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void copy()}
      title={t(`templateName.${row.template}`)}
    >
      <Copy className="h-4 w-4" />
      {t("copyNotice")}
    </Button>
  );
}
