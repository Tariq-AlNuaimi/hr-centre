"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { qs, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import type { RequisitionRow } from "../requisitions/RequisitionList";
import { omr } from "../offers/bits";
import type { OfferListRow } from "../offers/types";
import { Badge } from "@/components/ui/badge";

/**
 * Approvals (Interview Hub `/approvals`): requisitions awaiting headcount
 * approval in the reader's scope. Each opens its approval screen, where the
 * server decides who may sign.
 */
export function ApprovalsView() {
  const t = useTranslations("hiring.approvals");
  const locale = useLocale();
  const q = useHiringQuery<{ data: RequisitionRow[] }>(
    `/api/hiring/requisitions${qs({ status: "PENDING_APPROVAL", pageSize: 100 })}`,
  );
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <SectionCard title={t("requisitions")} noBodyPadding>
          {q.data?.data.length === 0 ? <EmptyState description={t("noRequisitions")} /> : null}
          <ul className="divide-y divide-border">
            {(q.data?.data ?? []).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{r.title}</p>
                  <p className="text-muted-foreground">
                    {[r.departmentName, r.entity?.name].filter(Boolean).join(" · ")} ·{" "}
                    {t("openings", { n: r.openings })} ·{" "}
                    {t("raised", { date: formatDate(r.createdAt) })}
                  </p>
                </div>
                <Link
                  className="text-primary-emphasis hover:underline"
                  href={`/${locale}/hiring/requisitions/${r.id}/approval`}
                >
                  {t("review")}
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </QueryState>
      <OffersAwaiting />
    </div>
  );
}

/** Offers waiting on their approval chain (Interview Hub "Offers awaiting decision"). */
function OffersAwaiting() {
  const t = useTranslations("hiring.approvals");
  const locale = useLocale();
  const q = useHiringQuery<{ data: OfferListRow[] }>(
    `/api/hiring/offers${qs({ status: "PENDING_APPROVAL", pageSize: 100 })}`,
  );
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rows={3}>
      <SectionCard title={t("offers")} subtitle={t("offersHint")} noBodyPadding>
        {q.data?.data.length === 0 ? <EmptyState description={t("noOffers")} /> : null}
        <ul className="divide-y divide-border">
          {(q.data?.data ?? []).map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">{o.candidate.name}</p>
                <p className="text-muted-foreground">
                  {[
                    o.requisition.title,
                    o.compHidden ? null : omr(o.salary),
                    o.submittedBy ? t("submittedBy", { name: o.submittedBy }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {o.escalatesCoo ? <Badge variant="warning">{t("cooEscalation")}</Badge> : null}
                <Link
                  className="text-primary-emphasis hover:underline"
                  href={`/${locale}/hiring/offers/${o.id}`}
                >
                  {t("review")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </QueryState>
  );
}
