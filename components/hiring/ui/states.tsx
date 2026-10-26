"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { HiringApiError } from "./api";

/** Honest loading / error / not-found for a hiring screen's main query. */
export function QueryState({
  isLoading,
  error,
  onRetry,
  children,
  rows = 6,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
  rows?: number;
}) {
  const t = useTranslations("hiring.common");
  if (isLoading) return <PageSkeleton rows={rows} />;
  if (error) {
    const notFound =
      error instanceof HiringApiError && (error.status === 404 || error.status === 403);
    return (
      <div role="alert" className="rounded-md border border-border bg-card p-6 text-sm">
        <p className="font-medium text-foreground">
          {notFound ? t("notFoundTitle") : t("errorTitle")}
        </p>
        <p className="mt-1 text-muted-foreground">
          {notFound ? t("notFoundBody") : (error as Error).message}
        </p>
        {!notFound && onRetry ? (
          <Button variant="outline" className="mt-3" onClick={onRetry}>
            {t("retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

/** A one-line inline notice (info / warning / danger) — the AntD Alert replacement. */
export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    info: "border-status-info bg-status-info text-status-info-fg",
    warning: "border-status-warn bg-status-warn text-status-warn-fg",
    danger: "border-status-err bg-status-err text-status-err-fg",
    success: "border-status-ok bg-status-ok text-status-ok-fg",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : ""}>{children}</div> : null}
    </div>
  );
}
