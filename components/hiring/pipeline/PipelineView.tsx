"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { useHiringMe } from "../ui/api";
import { ViewSwitch } from "../candidates/ViewSwitch";
import { PipelineBoard } from "./PipelineBoard";

/** `/hiring/pipeline` — the live board across every open requisition in scope. */
export function PipelineView() {
  const t = useTranslations("hiring.pipeline");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const add = () => router.push(`/${locale}/hiring/candidates/new`);
  return (
    <div className="space-y-4">
      <ViewSwitch active="board" />
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          has("hiring.manage") ? (
            <Button onClick={add}>
              <Plus className="h-4 w-4" />
              {t("add")}
            </Button>
          ) : null
        }
      />
      <PipelineBoard
        empty={
          <EmptyState
            description={t("empty")}
            actionLabel={has("hiring.manage") ? t("add") : undefined}
            onAction={add}
            actionVariant="outline"
          />
        }
      />
    </div>
  );
}
