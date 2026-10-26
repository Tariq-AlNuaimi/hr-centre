"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";

/** The honest triad every JML screen uses: loading, refused, failed. */
export function LoadingBlock() {
  return <div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" />;
}

export function NotPermitted({ title }: { title: string }) {
  const t = useTranslations("jml.common");
  return (
    <SectionCard title={title}>
      <EmptyState description={t("notPermitted")} />
    </SectionCard>
  );
}

export function LoadFailed() {
  const t = useTranslations("jml.common");
  return (
    <p role="alert" className="text-sm text-destructive-emphasis">
      {t("loadFailed")}
    </p>
  );
}
