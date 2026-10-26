"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { useHiringMutation } from "../ui/api";
import type { RequisitionDetail } from "./types";

/** Header shortcut: publish to / withdraw from the careers page (posts the CAREERS_PAGE channel). */
export function CareersToggle({ req }: { req: RequisitionDetail }) {
  const t = useTranslations("hiring.requisition");
  const path = `/api/hiring/requisitions/${req.id}/postings`;
  const post = useHiringMutation<object>("POST", path, { success: t("published") });
  const withdraw = useHiringMutation<undefined>("DELETE", `${path}?channel=CAREERS_PAGE`, {
    success: t("unpublished"),
  });
  if (req.liveOnCareers) {
    return (
      <ConfirmAction title={t("unpublishConfirm")} onConfirm={() => withdraw.mutate(undefined)}>
        <Button variant="outline" disabled={withdraw.isPending}>
          {t("unpublish")}
        </Button>
      </ConfirmAction>
    );
  }
  if (req.status !== "OPEN" || !req.jdApprovedAt) return null;
  return (
    <ConfirmAction
      title={t("publishConfirm")}
      onConfirm={() => post.mutate({ channel: "CAREERS_PAGE" })}
    >
      <Button disabled={post.isPending}>{t("publish")}</Button>
    </ConfirmAction>
  );
}
