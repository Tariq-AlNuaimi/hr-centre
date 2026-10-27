"use client";

import { daysUntil, formatDay } from "@/lib/format";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Small shared pieces of the JML case screens: status badge, progress, pager. */

const STATUS_VARIANT: Record<
  string,
  "default" | "brand" | "success" | "warning" | "danger" | "info" | "outline"
> = {
  DRAFT: "outline",
  ACTIVE: "brand",
  AT_RISK: "warning",
  PENDING_SETTLEMENT: "info",
  COMPLETED: "success",
  CLOSED: "success",
  CANCELLED: "danger",
  ARCHIVED: "default",
};

export function CaseStatusBadge({ status }: { status: string }) {
  const t = useTranslations("jml.vocab.caseStatus");
  return <Badge variant={STATUS_VARIANT[status] ?? "default"}>{t(status)}</Badge>;
}

export function Progress({ value }: { value: number }) {
  const t = useTranslations("jml.common");
  return (
    <div className="flex min-w-24 items-center gap-2">
      <div
        className="h-1.5 flex-1 rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progress")}
      >
        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{t("percent", { value })}</span>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("jml.common");
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t("previous")}
      </Button>
      <span className="text-muted-foreground">{t("pageOf", { page, total: totalPages })}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t("next")}
      </Button>
    </div>
  );
}

/** A YYYY-MM-DD for display, or a dash. */
export function DateText({ value }: { value: string | null | undefined }) {
  const t = useTranslations("jml.common");
  return <span className="tabular-nums">{value ? formatDay(value) : t("dash")}</span>;
}

/**
 * A due date said relatively (UX P1 perf-jml P1-3e): "3 days overdue", "Due
 * today", "Due in 4 days" — with the calendar date on hover. A settled task
 * shows the plain date.
 */
export function DueLabel({ value, settled = false }: { value: string | null; settled?: boolean }) {
  const tDue = useTranslations("jml.common.due");
  if (!value) return <span className="text-muted-foreground">{tDue("none")}</span>;
  if (settled) return <span className="tabular-nums">{formatDay(value)}</span>;
  const days = daysUntil(value);
  const tone =
    days < 0
      ? "text-destructive-emphasis font-medium"
      : days <= 2
        ? "text-foreground"
        : "text-muted-foreground";
  const text =
    days < 0
      ? tDue("overdue", { count: -days })
      : days === 0
        ? tDue("today")
        : tDue("inDays", { count: days });
  return (
    <span className={tone} title={formatDay(value)}>
      {text}
    </span>
  );
}

const RAG_VARIANT = { GREEN: "success", AMBER: "warning", RED: "danger" } as const;

/** The case's risk flag (computed by the engine; shown, finally — perf-jml headline 5). */
export function RagBadge({ flag }: { flag: "GREEN" | "AMBER" | "RED" }) {
  const tRag = useTranslations("jml.common.rag");
  return <Badge variant={RAG_VARIANT[flag]}>{tRag(flag)}</Badge>;
}
