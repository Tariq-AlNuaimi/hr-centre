"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { SectionCard } from "@/components/shared/SectionCard";
import { useHiringMe, useHiringMutation } from "../ui/api";

/**
 * Data-subject requests (PDPL): export everything held about the candidate, or
 * erase it in full. Shown only to people with org-wide erase rights; the route
 * re-checks.
 */
export function DataRequestCard({ candidateId, hired }: { candidateId: string; hired: boolean }) {
  const t = useTranslations("hiring.dsar");
  const { has } = useHiringMe();
  const router = useRouter();
  const locale = useLocale();
  const erase = useHiringMutation<undefined>(
    "DELETE",
    `/api/hiring/candidates/${candidateId}/dsar`,
    {
      success: t("erased"),
      onSuccess: () => router.push(`/${locale}/hiring/candidates`),
    },
  );
  if (!has("hiring.erase")) return null;
  return (
    <SectionCard title={t("title")} subtitle={t("hint")}>
      <div className="flex flex-wrap gap-2">
        <a
          className={buttonVariants({ variant: "outline" })}
          href={`/api/hiring/candidates/${candidateId}/dsar`}
        >
          <Download className="h-4 w-4" />
          {t("export")}
        </a>
        {hired ? (
          <p className="text-sm text-muted-foreground">{t("employee")}</p>
        ) : (
          <ConfirmAction
            title={t("confirmTitle")}
            description={t("confirmBody")}
            onConfirm={() => erase.mutate(undefined)}
          >
            <Button variant="destructive" disabled={erase.isPending}>
              <Eraser className="h-4 w-4" />
              {t("erase")}
            </Button>
          </ConfirmAction>
        )}
      </div>
    </SectionCard>
  );
}
