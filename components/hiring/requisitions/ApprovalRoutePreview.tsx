"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { qs, useHiringQuery } from "../ui/api";

type Step = { sequence: number; role: string; approvers: { id: string; name: string }[] };

/** "Who approves this" before it is submitted (Interview Hub approval-route preview). */
export function ApprovalRoutePreview(props: {
  entityId: string;
  departmentId?: string | null;
  bandMax?: string;
  currency?: string;
}) {
  const t = useTranslations("hiring.request");
  const tr = useTranslations("hiring.roles");
  const { data, isLoading } = useHiringQuery<{ steps: Step[] }>(
    `/api/hiring/requests/approval-route${qs({
      entityId: props.entityId,
      departmentId: props.departmentId,
      bandMax: props.bandMax,
      currency: props.currency,
    })}`,
  );
  return (
    <SectionCard title={t("routeTitle")} subtitle={t("routeHint")}>
      {isLoading ? <p className="text-sm text-muted-foreground">{t("routeLoading")}</p> : null}
      <ol className="space-y-2">
        {(data?.steps ?? []).map((s) => (
          <li key={s.sequence} className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium text-foreground">
              {s.sequence}. {tr(s.role)}
            </span>
            <span className="text-muted-foreground">
              {s.approvers.length ? s.approvers.map((a) => a.name).join(", ") : t("routeVacant")}
            </span>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
