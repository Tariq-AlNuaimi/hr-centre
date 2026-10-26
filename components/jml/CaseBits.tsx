"use client";

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
  return <span className="tabular-nums">{value ? value.slice(0, 10) : t("dash")}</span>;
}
